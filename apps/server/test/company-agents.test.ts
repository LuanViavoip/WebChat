import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SessionService } from '../src/auth/sessions.js';
import { withTenant } from '../src/db/tenant.js';
import { loadConfig } from '../src/config.js';
import type { AgentPrincipal } from '../src/domain/types.js';
import { demoAccounts, demoIds, demoPassword } from '../src/demo/ids.js';
import { CompanyAdministrationService } from '../src/modules/company-administration.js';
import {
  connectSocket,
  emitAck,
  login,
  postJson,
  startTestApp,
  waitConnect,
  waitEvent,
  type TestApp,
} from './helpers.js';

let app: TestApp;
const service = () => new CompanyAdministrationService(app.pool);
const otavio: AgentPrincipal = {
  kind: 'admin',
  tenantId: demoIds.tenantA,
  agentId: demoIds.adminOtavio,
  sessionId: 'aaaaaaaa-1111-4111-8111-aaaaaaaaaa99',
  expiresAt: '2026-12-01T00:00:00.000Z',
  name: 'Otávio Ramos',
};

beforeAll(async () => {
  app = await startTestApp();
});

afterAll(async () => {
  const admin = new pg.Client({ connectionString: process.env.MIGRATE_DATABASE_URL });
  await admin.connect();
  try {
    await admin.query(`DELETE FROM agent_queues WHERE agent_id IN (SELECT id FROM agents WHERE email = 'nova@tenant-a.local')`);
    await admin.query(`DELETE FROM auth_sessions WHERE agent_id IN (SELECT id FROM agents WHERE email = 'nova@tenant-a.local')`);
    await admin.query(`DELETE FROM agents WHERE email = 'nova@tenant-a.local'`);
  } finally {
    await admin.end();
    await app.app.close();
  }
});

describe('pessoas e revogação', () => {
  it('exige Redis quando há mais de uma réplica', async () => {
    expect(() => loadConfig({ ...process.env, REPLICAS: '2', REDIS_URL: '' })).toThrow(/REDIS_URL/);
    await expect(startTestApp({ replicaCount: 2, redisUrl: null })).rejects.toThrow(/REDIS_URL/);
  });

  it('não suspende o último administrador e não vaza o e-mail de outra empresa', async () => {
    await expect(
      service().apply(otavio, {
        requestId: randomUUID(),
        command: { kind: 'agent.suspend', agentId: demoIds.adminOtavio, reason: 'saída' },
      }),
    ).rejects.toMatchObject({ code: 'invalid_state' });
    await expect(
      service().apply(otavio, {
        requestId: randomUUID(),
        command: {
          kind: 'agent.create',
          email: demoAccounts.carla,
          name: 'Carla Duplicada',
          password: 'senha-inicial-12',
          placement: { role: 'agent', queueIds: [], activityAuthority: { kind: 'assigned_only' } },
        },
      }),
    ).rejects.toMatchObject({ code: 'conflict' });
  });

  it('cria a pessoa uma vez e recusa o login depois da suspensão', async () => {
    const requestId = randomUUID();
    const envelope = {
      requestId,
      command: {
        kind: 'agent.create' as const,
        email: 'nova@tenant-a.local',
        name: 'Nova Agente',
        password: 'senha-inicial-12',
        placement: {
          role: 'agent' as const,
          queueIds: [demoIds.queueSupportA],
          activityAuthority: { kind: 'assigned_only' as const },
        },
      },
    };
    const created = await service().apply(otavio, envelope);
    expect(created.result.receipt.replayed).toBe(false);
    const replay = await service().apply(otavio, envelope);
    expect(replay.result.receipt.replayed).toBe(true);
    const people = replay.result.desk.agents.filter((agent) => agent.email === 'nova@tenant-a.local');
    expect(people).toHaveLength(1);
    const session = await login(app.baseUrl, 'nova@tenant-a.local', 'senha-inicial-12');
    expect(session.role).toBe('agent');
    const agentId = people[0]?.agentId ?? '';
    await service().apply(otavio, {
      requestId: randomUUID(),
      command: { kind: 'agent.suspend', agentId, reason: 'afastamento' },
    });
    const denied = await postJson(`${app.baseUrl}/auth/login`, {
      email: 'nova@tenant-a.local',
      password: 'senha-inicial-12',
    });
    expect(denied.status).toBe(401);
    await expect(
      withTenant(app.pool, demoIds.tenantA, (client) => client.query('SELECT password_hash FROM agents')),
    ).rejects.toThrow(/permission denied/i);
  });

  it('desconecta o socket pelo aviso do Postgres e pela época no próximo evento', async () => {
    const anaLogin = await login(app.baseUrl, demoAccounts.ana, demoPassword);
    const socket = connectSocket(app.baseUrl, '/agent', anaLogin.token);
    await waitConnect(socket);
    const disconnected = waitEvent(socket, 'disconnect');
    const suspended = await service().apply(otavio, {
      requestId: randomUUID(),
      command: { kind: 'agent.suspend', agentId: demoIds.agentAna, reason: 'turno encerrado' },
    });
    expect(suspended.revokedSessionIds.length).toBeGreaterThan(0);
    await disconnected;
    expect(socket.connected).toBe(false);

    await service().apply(otavio, {
      requestId: randomUUID(),
      command: { kind: 'agent.reactivate', agentId: demoIds.agentAna },
    });
    const returned = await login(app.baseUrl, demoAccounts.ana, demoPassword);
    const again = connectSocket(app.baseUrl, '/agent', returned.token);
    await waitConnect(again);
    await withTenant(app.pool, demoIds.tenantA, (client) =>
      client.query(`UPDATE agents SET auth_epoch = auth_epoch + 1 WHERE id = $1`, [demoIds.agentAna]),
    );
    const dropped = waitEvent(again, 'disconnect');
    void emitAck(again, 'internal.list', {}).catch(() => undefined);
    await dropped;
    expect(again.connected).toBe(false);
  });
});

describe('varredura de sessão', () => {
  it('derruba o socket quando a época muda e o aviso não chega', async () => {
    const calls: number[] = [];
    const original = SessionService.prototype.staffSessionsAllowed;
    SessionService.prototype.staffSessionsAllowed = async function (sessionIds: readonly string[]) {
      calls.push(sessionIds.length);
      return original.call(this, sessionIds);
    };
    const sweeping = await startTestApp({ sessionRevokeSweepMs: 200 }, { notify: false, direct: false });
    try {
      const bruno = await login(sweeping.baseUrl, demoAccounts.bruno, demoPassword);
      const socket = connectSocket(sweeping.baseUrl, '/agent', bruno.token);
      await waitConnect(socket);
      const disconnected = waitEvent(socket, 'disconnect');
      await withTenant(sweeping.pool, demoIds.tenantA, (client) =>
        client.query(`UPDATE agents SET auth_epoch = auth_epoch + 1 WHERE id = $1`, [demoIds.agentBruno]),
      );
      await disconnected;
      expect(socket.connected).toBe(false);
      expect(calls.length).toBeGreaterThan(0);
      expect(calls.every((size) => size === 1)).toBe(true);
    } finally {
      SessionService.prototype.staffSessionsAllowed = original;
      await sweeping.app.close();
    }
  });
});
