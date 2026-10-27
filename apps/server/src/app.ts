import cors from '@fastify/cors';
import { Server } from 'socket.io';
import type { SMAdapter } from '@viavoip/sm-adapter';
import Fastify, { type FastifyInstance } from 'fastify';
import type pg from 'pg';
import { SessionService } from './auth/sessions.js';
import type { AppConfig } from './config.js';
import { createPool } from './db/pool.js';
import { SlidingWindowLimiter } from './http/rate-limit.js';
import { registerHttp } from './http/routes.js';
import { registerStatic } from './http/static.js';
import { ActivityService } from './modules/activities.js';
import { AnnouncementService } from './modules/announcements.js';
import { ConversationService } from './modules/conversations.js';
import { InternalChatService } from './modules/internal-chat.js';
import { MessageService } from './modules/messages.js';
import { PresenceService } from './modules/presence.js';
import { SectorService } from './modules/sectors.js';
import { SupervisorService } from './modules/supervisor.js';
import { SocketHub } from './realtime/hub.js';
import { attachRedis } from './realtime/redis.js';
import { refreshSupervisors } from './realtime/refresh.js';
import { registerRealtime } from './realtime/register.js';

export type WebChatApp = {
  app: FastifyInstance;
  io: Server;
  pool: pg.Pool;
  sm: SMAdapter;
  sweepPresence: () => Promise<void>;
};

export async function buildApp(config: AppConfig, sm: SMAdapter): Promise<WebChatApp> {
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

  await app.register(cors, { origin: config.corsOrigins, credentials: false });
  registerHttp(app, {
    sessions,
    smAdapter: config.smAdapter,
    limiter,
    sessionCreateLimit: config.sessionCreateLimit,
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

  app.addHook('onClose', async () => {
    clearInterval(timer);
    io.disconnectSockets(true);
    io.close();
    await pool.end();
    if (closeRedis) await closeRedis();
  });

  return { app, io, pool, sm, sweepPresence };
}
