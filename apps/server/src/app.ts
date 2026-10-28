import cors from '@fastify/cors';
import { Server } from 'socket.io';
import type { SMAdapter } from '@viavoip/sm-adapter';
import Fastify, { type FastifyInstance } from 'fastify';
import pg from 'pg';
import { createClient, type RedisClientType } from 'redis';
import { SessionService } from './auth/sessions.js';
import { SharedLoginRateLimiter } from './auth/login-rate-limit.js';
import type { AppConfig } from './config.js';
import { createPool } from './db/pool.js';
import { SlidingWindowLimiter } from './http/rate-limit.js';
import { registerCompanyHttp } from './http/company-routes.js';
import { registerHttp } from './http/routes.js';
import { registerStatic } from './http/static.js';
import { ActivityService } from './modules/activities.js';
import { AuditQueryService } from './modules/audit-query.js';
import { CompanyAdministrationService } from './modules/company-administration.js';
import { OperationalQualityService } from './modules/operational-quality.js';
import { AnnouncementService } from './modules/announcements.js';
import { ConversationService } from './modules/conversations.js';
import { InternalChatService } from './modules/internal-chat.js';
import { MessageService } from './modules/messages.js';
import { PresenceService } from './modules/presence.js';
import { SectorService } from './modules/sectors.js';
import { SupervisorService } from './modules/supervisor.js';
import { SocketHub } from './realtime/hub.js';
import { revokeRealtimeSessions } from './realtime/revoke.js';
import { createSweepLoop, degradedSweepMs, sweepStaffSockets } from './realtime/revoke-sweep.js';
import { attachRedis } from './realtime/redis.js';
import { refreshSupervisors } from './realtime/refresh.js';
import { registerRealtime } from './realtime/register.js';

export type RevokeBuildOptions = {
  notify?: boolean;
  direct?: boolean;
  sweepMs?: number;
  sweepEnabled?: boolean;
};

export type WebChatApp = {
  app: FastifyInstance;
  io: Server;
  pool: pg.Pool;
  sm: SMAdapter;
  sweepPresence: () => Promise<void>;
  revokeListener: pg.Client | null;
  revokeSweepIntervalMs: () => number;
};

export async function buildApp(
  config: AppConfig,
  sm: SMAdapter,
  options?: { revoke?: RevokeBuildOptions },
): Promise<WebChatApp> {
  if (config.replicaCount > 1 && !config.redisUrl) {
    throw new Error('REDIS_URL é obrigatório com mais de uma réplica');
  }
  const app = Fastify({
    logger: config.logger,
    bodyLimit: 32 * 1024,
    forceCloseConnections: true,
  });
  const pool = createPool(config.databaseUrl);
  const io = new Server(app.server, {
    transports: ['websocket'],
    cors: { origin: config.corsOrigins, credentials: false },
    maxHttpBufferSize: 100_000,
  });
  const closeRedis = config.redisUrl ? await attachRedis(io, config.redisUrl) : null;
  const sessions = await SessionService.create(pool, config.sessionTtlHours);
  const presence = new PresenceService(pool, config.presenceStaleMs);
  const conversations = new ConversationService(pool, presence);
  const messages = new MessageService(pool);
  const sectors = new SectorService(pool);
  const internalChat = new InternalChatService(pool);
  const announcements = new AnnouncementService(pool);
  const activities = new ActivityService(pool);
  const supervisor = new SupervisorService(pool, config.presenceStaleMs);
  const hub = new SocketHub(io);
  hub.setChangeListener((tenantId) => {
    void refreshSupervisors(io, supervisor, tenantId, app.log);
  });
  const limiter = new SlidingWindowLimiter(config.rateWindowMs);
  const loginAttempts = new SharedLoginRateLimiter(pool, config.rateWindowMs);

  await app.register(cors, { origin: config.corsOrigins, credentials: false });
  registerHttp(app, {
    sessions,
    smAdapter: config.smAdapter,
    limiter,
    sessionCreateLimit: config.sessionCreateLimit,
    loginLimit: config.loginLimit,
    loginAttempts,
    loginRateLimitSecret: config.loginRateLimitSecret,
    io,
  });
  registerCompanyHttp(app, {
    sessions,
    administration: new CompanyAdministrationService(pool),
    quality: new OperationalQualityService(pool),
    audit: new AuditQueryService(pool),
    io,
    directRevoke: options?.revoke?.direct !== false,
  });
  if (config.serveStatic) await registerStatic(app);
  registerRealtime(io, {
    sessions,
    conversations,
    messages,
    presence,
    sectors,
    internalChat,
    announcements,
    activities,
    supervisor,
    sm,
    hub,
    logger: app.log,
    limiter,
    messageLimit: config.messageLimit,
  });

  const sweepPresence = async () => {
    const changes = await presence.sweep();
    for (const item of changes) {
      hub.presenceUpdated(item.tenantId, item.agentId, item.queueIds, item.status);
    }
  };
  const timer = setInterval(() => {
    void sweepPresence().catch((error: unknown) => {
      app.log.error({ err: error }, 'falha ao varrer presença');
    });
  }, 15_000);
  timer.unref();
  const notifyEnabled = options?.revoke?.notify !== false;
  const sweepEnabled = options?.revoke?.sweepEnabled !== false;
  let listenUp = !notifyEnabled;
  let redisUp: boolean | null = config.redisUrl ? true : null;
  let revokeListener: pg.Client | null = null;
  let revokeStopped = false;
  let redisHealth: RedisClientType | null = null;
  if (config.redisUrl) {
    redisHealth = createClient({ url: config.redisUrl });
    redisHealth.on('error', () => {
      redisUp = false;
    });
    await redisHealth.connect();
  }
  const openRevokeListener = async () => {
    if (revokeStopped || !notifyEnabled) return;
    const client = new pg.Client({ connectionString: config.databaseUrl });
    revokeListener = client;
    client.on('error', (error: Error) => {
      listenUp = false;
      revokeLoop.reschedule();
      app.log.error({ err: error }, 'conexão de revogação encerrada');
    });
    client.on('end', () => {
      listenUp = false;
      revokeLoop.reschedule();
      if (!revokeStopped) setTimeout(() => void openRevokeListener(), 1_000);
    });
    try {
      await client.connect();
      await client.query('LISTEN webchat_session_revoke');
      client.on('notification', (message) => {
        if (message.channel !== 'webchat_session_revoke' || !message.payload) return;
        try {
          const body = JSON.parse(message.payload) as { sessionId?: string };
          if (body.sessionId) revokeRealtimeSessions(io, [body.sessionId]);
        } catch (error: unknown) {
          app.log.error({ err: error }, 'aviso de revogação inválido');
        }
      });
      listenUp = true;
      revokeLoop.reschedule();
    } catch (error: unknown) {
      listenUp = false;
      revokeLoop.reschedule();
      app.log.error({ err: error }, 'falha ao escutar revogação');
      try {
        await client.end();
      } catch {
        // O fim da conexão dispara uma nova tentativa.
      }
    }
  };
  const sweepRevokedSessions = async () => {
    if (redisHealth) {
      try {
        await redisHealth.ping();
        if (redisUp === false) {
          redisUp = true;
          revokeLoop.reschedule();
        }
      } catch (error: unknown) {
        redisUp = false;
        revokeLoop.reschedule();
        app.log.error({ err: error }, 'redis da revogação não respondeu');
      }
    }
    const sockets = [];
    for (const namespace of ['/agent', '/supervisor'] as const) {
      sockets.push(...(await io.of(namespace).fetchSockets()));
    }
    await sweepStaffSockets(sockets, (sessionIds) => sessions.staffSessionsAllowed(sessionIds));
  };
  const revokeLoop = createSweepLoop({
    healthyMs: options?.revoke?.sweepMs ?? config.sessionRevokeSweepMs,
    degradedMs: degradedSweepMs,
    isDegraded: () => !listenUp || redisUp === false,
    onTick: async () => {
      await sweepRevokedSessions().catch((error: unknown) => {
        app.log.error({ err: error }, 'falha ao varrer sessões revogadas');
      });
    },
  });
  if (!sweepEnabled) revokeLoop.stop();
  if (notifyEnabled) await openRevokeListener();
  const loginRateLimitTimer = setInterval(() => {
    void loginAttempts.sweepExpired().catch((error: unknown) => {
      app.log.error({ err: error }, 'falha ao limpar limites de login expirados');
    });
  }, 60 * 60 * 1000);
  loginRateLimitTimer.unref();

  app.addHook('onClose', async () => {
    clearInterval(timer);
    clearInterval(loginRateLimitTimer);
    revokeStopped = true;
    revokeLoop.stop();
    if (revokeListener) await revokeListener.end();
    if (redisHealth) await redisHealth.quit();
    io.disconnectSockets(true);
    io.close();
    await pool.end();
    if (closeRedis) await closeRedis();
  });

  return { app, io, pool, sm, sweepPresence, revokeListener, revokeSweepIntervalMs: () => revokeLoop.intervalMs() };
}
