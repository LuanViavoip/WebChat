import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../src/config.js';
import { withTenant } from '../src/db/tenant.js';
import { demoAccounts, demoIds, demoPassword } from '../src/demo/ids.js';
import { createSweepLoop, degradedSweepMs, sweepStaffSockets } from '../src/realtime/revoke-sweep.js';
import { connectSocket, login, startTestApp, waitConnect, waitEvent, type TestApp } from './helpers.js';
import pg from 'pg';

describe('varredura de revogação', () => {
  it('recusa intervalo acima de 15s fora de teste e ignora flags de caminho', () => {
    expect(() =>
      loadConfig({
        ...process.env,
        NODE_ENV: 'production',
        REPLICAS: '1',
        REDIS_URL: '',
        SESSION_REVOKE_SWEEP_MS: '120000',
        ALLOW_SLOW_REVOKE_SWEEP: '',
      }),
    ).toThrow(/15 segundos/);
    const config = loadConfig({
      ...process.env,
      NODE_ENV: 'test',
      REPLICAS: '1',
      REDIS_URL: '',
      SESSION_REVOKE_NOTIFY: 'false',
      SESSION_REVOKE_DIRECT: 'false',
      SESSION_REVOKE_SWEEP_MS: '120000',
    });
    expect(config.sessionRevokeSweepMs).toBe(120_000);
    expect('sessionRevokeNotify' in config).toBe(false);
    expect('sessionRevokeDirect' in config).toBe(false);
  });

  it('consulta o lote uma vez para cinquenta sockets', async () => {
    const calls: string[][] = [];
    const sockets = Array.from({ length: 50 }, (_, index) => ({
      data: {
        principal: {
          kind: 'agent',
          sessionId: `aaaaaaaa-1111-4111-8111-${String(index).padStart(12, '0')}`,
        },
      },
      disconnect: vi.fn(),
    }));
    const dead = sockets[3];
    await sweepStaffSockets(sockets, async (sessionIds) => {
      calls.push([...sessionIds]);
      return new Map(
        sessionIds
          .filter((id) => id !== dead?.data.principal.sessionId)
          .map((id) => [id, 'agent']),
      );
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toHaveLength(50);
    expect(dead?.disconnect).toHaveBeenCalledWith(true);
    expect(sockets[0]?.disconnect).not.toHaveBeenCalled();
  });

  it('cai para 2s quando o caminho imediato degrada e volta ao intervalo saudável', async () => {
    vi.useFakeTimers();
    try {
      let degraded = false;
      let ticks = 0;
      const loop = createSweepLoop({
        healthyMs: 10_000,
        degradedMs: degradedSweepMs,
        isDegraded: () => degraded,
        onTick: async () => {
          ticks += 1;
        },
      });
      await vi.advanceTimersByTimeAsync(10_000);
      expect(ticks).toBe(1);
      degraded = true;
      loop.reschedule();
      expect(loop.intervalMs()).toBe(2_000);
      ticks = 0;
      await vi.advanceTimersByTimeAsync(2_000);
      expect(ticks).toBe(1);
      degraded = false;
      loop.reschedule();
      expect(loop.intervalMs()).toBe(10_000);
      loop.stop();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('escuta e fallback', () => {
  let app: TestApp;

  beforeAll(async () => {
    app = await startTestApp();
  });

  afterAll(async () => {
    await app.app.close();
  });

  it('abre o LISTEN mesmo se a env pedir para desligar', async () => {
    const previous = process.env.SESSION_REVOKE_NOTIFY;
    process.env.SESSION_REVOKE_NOTIFY = 'false';
    const admin = new pg.Client({ connectionString: process.env.MIGRATE_DATABASE_URL });
    await admin.connect();
    const listeners = async () => {
      const rows = await admin.query<{ total: number }>(
        `SELECT count(*)::int AS total
         FROM pg_stat_activity
         WHERE query ILIKE 'LISTEN webchat_session_revoke%'
           AND pid <> pg_backend_pid()`,
      );
      return rows.rows[0]?.total ?? 0;
    };
    const before = await listeners();
    const running = await startTestApp();
    try {
      expect(await listeners()).toBe(before + 1);
      expect(running.revokeListener).not.toBeNull();
    } finally {
      process.env.SESSION_REVOKE_NOTIFY = previous;
      await running.app.close();
      await admin.end();
    }
  });

  it('acelera a varredura quando o LISTEN cai', async () => {
    const running = await startTestApp({ sessionRevokeSweepMs: 10_000 }, { notify: true, direct: false });
    try {
      expect(running.revokeSweepIntervalMs()).toBe(10_000);
      await running.revokeListener?.end();
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(running.revokeSweepIntervalMs()).toBe(2_000);
    } finally {
      await running.app.close();
    }
  });

  it('sem notify e sem disconnect direto, só a varredura derruba', async () => {
    const running = await startTestApp(
      { sessionRevokeSweepMs: 200 },
      { notify: false, direct: false, sweepEnabled: true },
    );
    try {
      const ana = await login(running.baseUrl, demoAccounts.ana, demoPassword);
      const socket = connectSocket(running.baseUrl, '/agent', ana.token);
      await waitConnect(socket);
      const disconnected = waitEvent(socket, 'disconnect');
      await withTenant(running.pool, demoIds.tenantA, (client) =>
        client.query(`UPDATE agents SET auth_epoch = auth_epoch + 1 WHERE id = $1`, [demoIds.agentAna]),
      );
      await disconnected;
      expect(socket.connected).toBe(false);
    } finally {
      await running.app.close();
    }
  });
});

