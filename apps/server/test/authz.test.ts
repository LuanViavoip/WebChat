import { conversationAckSchema, historySyncAckSchema, messageSendAckSchema } from '@viavoip/protocol';
import { randomUUID } from 'node:crypto';
import { io } from 'socket.io-client';
import { createHash } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { demoAccounts, demoIds, demoPassword, demoSites } from '../src/demo/ids.js';
import { SharedLoginRateLimiter } from '../src/auth/login-rate-limit.js';
import { connectSocket, emitAck, login, openVisitor, postJson, startConversation, startTestApp, waitConnect, type TestApp } from './helpers.js';

let app: TestApp;

beforeAll(async () => {
  app = await startTestApp();
});

afterAll(async () => {
  await app.app.close();
});

describe('eventos sem autorização', () => {
  it('compartilha o contador de login entre instâncias', async () => {
    const firstReplica = new SharedLoginRateLimiter(app.pool, 60_000);
    const secondReplica = new SharedLoginRateLimiter(app.pool, 60_000);
    const ipKey = createHash('sha256').update(`ip:${randomUUID()}`).digest('hex');
    const accountKey = createHash('sha256').update(`account:${randomUUID()}`).digest('hex');
    expect(await firstReplica.allow([ipKey, accountKey], 2)).toBe(true);
    expect(await secondReplica.allow([ipKey, accountKey], 2)).toBe(true);
    expect(await firstReplica.allow([ipKey, accountKey], 2)).toBe(false);
  });

  it('encerra todas as conexões da sessão no logout e rejeita nova conexão', async () => {
    const session = await login(app.baseUrl, demoAccounts.ana, demoPassword);
    const socket = connectSocket(app.baseUrl, '/agent', session.token);
    await waitConnect(socket);
    const disconnected = new Promise<void>((resolve) => socket.once('disconnect', () => resolve()));
    const logout = await postJson(`${app.baseUrl}/auth/logout`, {}, session.token);
    expect(logout.status).toBe(200);
    await expect(disconnected).resolves.toBeUndefined();
    await expect(rejectedConnect('/agent', session.token)).resolves.toMatchObject({ message: expect.stringMatching(/unauthorized/i) });
  });

  it('não deixa handshake concorrente sobreviver ao logout', async () => {
    const session = await login(app.baseUrl, demoAccounts.ana, demoPassword);
    const socket = connectSocket(app.baseUrl, '/agent', session.token);
    const terminal = new Promise<void>((resolve) => {
      socket.once('disconnect', () => resolve());
      socket.once('connect_error', () => resolve());
    });
    const logout = await postJson(`${app.baseUrl}/auth/logout`, {}, session.token);
    expect(logout.status).toBe(200);
    const ended = await Promise.race([
      terminal.then(() => true),
      new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 1000)),
    ]);
    expect(ended).toBe(true);
    expect(socket.connected).toBe(false);
    socket.disconnect();
  });

  it('recusa claim de visitante, canal trocado e leitura cruzada', async () => {
    const visitor = await openVisitor(app.baseUrl, demoSites.a);
    const started = await startConversation(visitor.socket, demoIds.queueSupportA);
    const claim = conversationAckSchema.parse(
      await emitAck(visitor.socket, 'conversation.claim', { conversationId: started.conversation.id }),
    );
    expect(claim.ok).toBe(false);
    if (!claim.ok) expect(claim.error.code).toBe('forbidden');

    const closeAttempt = conversationAckSchema.parse(
      await emitAck(visitor.socket, 'conversation.close', {
        conversationId: started.conversation.id,
        dispositionId: demoIds.dispositionResolvedA,
      }),
    );
    expect(closeAttempt.ok).toBe(false);
    if (!closeAttempt.ok) expect(closeAttempt.error.code).toBe('forbidden');

    const visitorAsAgent = await rejectedConnect('/agent', visitor.session.token);
    expect(visitorAsAgent.message).toMatch(/unauthorized/i);

    const ana = await login(app.baseUrl, demoAccounts.ana, demoPassword);
    const agentAsSupervisor = await rejectedConnect('/supervisor', ana.token);
    expect(agentAsSupervisor.message).toMatch(/unauthorized/i);

    const sofia = await login(app.baseUrl, demoAccounts.sofia, demoPassword);
    const supervisor = io(`${app.baseUrl}/supervisor`, {
      auth: { token: sofia.token },
      transports: ['websocket'],
      reconnection: false,
      forceNew: true,
    });
    await new Promise<void>((resolve, reject) => {
      supervisor.once('connect', () => resolve());
      supervisor.once('connect_error', (error: Error) => reject(error));
    });
    const supervisorSend = messageSendAckSchema.parse(
      await emitAck(supervisor, 'message.send', {
        conversationId: started.conversation.id,
        requestId: randomUUID(),
        body: 'não autorizado',
      }),
    );
    expect(supervisorSend.ok).toBe(false);
    if (!supervisorSend.ok) expect(supervisorSend.error.code).toBe('forbidden');

    const carla = await login(app.baseUrl, demoAccounts.carla, demoPassword);
    const otherTenant = io(`${app.baseUrl}/agent`, {
      auth: { token: carla.token },
      transports: ['websocket'],
      reconnection: false,
      forceNew: true,
    });
    await new Promise<void>((resolve, reject) => {
      otherTenant.once('connect', () => resolve());
      otherTenant.once('connect_error', (error: Error) => reject(error));
    });
    const foreignHistory = historySyncAckSchema.parse(
      await emitAck(otherTenant, 'history.sync', { conversationId: started.conversation.id }),
    );
    expect(foreignHistory.ok).toBe(false);
    if (!foreignHistory.ok) expect(foreignHistory.error.code).toBe('not_found');

    visitor.socket.disconnect();
    supervisor.disconnect();
    otherTenant.disconnect();
  });
});

function rejectedConnect(namespace: string, token: string): Promise<Error> {
  const socket = io(`${app.baseUrl}${namespace}`, {
    auth: { token },
    transports: ['websocket'],
    reconnection: false,
    forceNew: true,
  });
  return new Promise((resolve, reject) => {
    socket.once('connect', () => {
      socket.disconnect();
      reject(new Error('conexão indevida'));
    });
    socket.once('connect_error', (error: Error) => {
      socket.disconnect();
      resolve(error);
    });
  });
}
