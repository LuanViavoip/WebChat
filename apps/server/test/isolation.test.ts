import { conversationAckSchema } from '@viavoip/protocol';
import { io } from 'socket.io-client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withTenant } from '../src/db/tenant.js';
import { demoAccounts, demoIds, demoPassword, demoSites } from '../src/demo/ids.js';
import { connectSocket, emitAck, login, openVisitor, startConversation, startTestApp, trackTestSocket, type TestApp, waitConnect } from './helpers.js';

let app: TestApp;

beforeAll(async () => {
  app = await startTestApp();
});

afterAll(async () => {
  await app.app.close();
});

describe('isolamento entre tenants', () => {
  it('não devolve linhas quando a transação não define o tenant', async () => {
    const result = await app.pool.query('SELECT id FROM sites');
    expect(result.rows).toEqual([]);
  });

  it('esconde agentes, filas e o hash de senha do outro tenant', async () => {
    const emails = await withTenant(app.pool, demoIds.tenantA, async (client) => {
      const result = await client.query<{ email: string }>('SELECT email FROM agents ORDER BY email');
      return result.rows.map((row) => row.email);
    });
    expect(emails).toEqual([
      demoAccounts.ana,
      demoAccounts.bruno,
      demoAccounts.diana,
      demoAccounts.eduardo,
      demoAccounts.helena,
      demoAccounts.otavio,
      demoAccounts.sofia,
    ]);
    expect(emails).not.toContain(demoAccounts.carla);

    const queues = await withTenant(app.pool, demoIds.tenantA, async (client) => {
      const result = await client.query<{ id: string }>('SELECT id FROM queues ORDER BY name');
      return result.rows.map((row) => row.id);
    });
    expect(queues).toEqual([demoIds.queueSupportA, demoIds.queueSalesA]);
    expect(queues).not.toContain(demoIds.queueSupportB);

    await expect(
      withTenant(app.pool, demoIds.tenantA, (client) => client.query('SELECT password_hash FROM agents')),
    ).rejects.toThrow(/permission denied/i);
  });

  it('desfaz a transação quando o trabalho falha', async () => {
    await expect(
      withTenant(app.pool, demoIds.tenantA, async (client) => {
        await client.query(`INSERT INTO dispositions (tenant_id, name) VALUES ($1, 'rollback-teste')`, [
          demoIds.tenantA,
        ]);
        throw new Error('falha');
      }),
    ).rejects.toThrow('falha');
    const left = await withTenant(app.pool, demoIds.tenantA, (client) =>
      client.query(`SELECT id FROM dispositions WHERE name = 'rollback-teste'`),
    );
    expect(left.rows).toEqual([]);
  });

  it('rejeita tenantId enviado pelo cliente e isola a conversa no socket', async () => {
    const rejected = await fetch(`${app.baseUrl}/visitor/sessions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sitePublicId: demoSites.a, tenantId: demoIds.tenantB }),
    });
    expect(rejected.status).toBe(400);

    const visitorB = await openVisitor(app.baseUrl, demoSites.b);
    expect(visitorB.session.queues.map((queue) => queue.id).sort()).toEqual(
      [demoIds.queueSupportB, demoIds.queueSalesB].sort(),
    );
    visitorB.socket.disconnect();

    const visitorA = await openVisitor(app.baseUrl, demoSites.a);
    const started = await startConversation(visitorA.socket, demoIds.queueSupportA);
    const agentB = await login(app.baseUrl, demoAccounts.carla, demoPassword);
    const carla = connectSocket(app.baseUrl, '/agent', agentB.token);
    await waitConnect(carla);
    const claim = conversationAckSchema.parse(
      await emitAck(carla, 'conversation.claim', { conversationId: started.conversation.id }),
    );
    expect(claim.ok).toBe(false);
    if (!claim.ok) expect(claim.error.code).toBe('not_found');

    const handshake = trackTestSocket(io(`${app.baseUrl}/agent`, {
      auth: { token: agentB.token, tenantId: demoIds.tenantA },
      transports: ['websocket'],
      reconnection: false,
      forceNew: true,
    }));
    const handshakeError = await new Promise<Error>((resolve, reject) => {
      handshake.once('connect', () => reject(new Error('conexão indevida')));
      handshake.once('connect_error', (cause: Error) => resolve(cause));
    });
    handshake.disconnect();
    expect(handshakeError.message).toMatch(/unauthorized/i);

    visitorA.socket.disconnect();
    carla.disconnect();
  });
});
