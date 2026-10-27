import { conversationAckSchema, historySyncAckSchema, messageSendAckSchema } from '@viavoip/protocol';
import { randomUUID } from 'node:crypto';
import { io } from 'socket.io-client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { demoAccounts, demoIds, demoPassword, demoSites } from '../src/demo/ids.js';
import { emitAck, login, openVisitor, startConversation, startTestApp, type TestApp } from './helpers.js';

let app: TestApp;

beforeAll(async () => {
  app = await startTestApp();
});

afterAll(async () => {
  await app.app.close();
});

describe('eventos sem autorização', () => {
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
