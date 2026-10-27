import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { internalListAckSchema, internalMessageSchema, messageSendAckSchema } from '@viavoip/protocol';
import { demoAccounts, demoIds, demoPassword } from '../src/demo/ids.js';
import { connectSocket, emitAck, login, postJson, startTestApp, waitConnect, waitEvent, type TestApp } from './helpers.js';

// Reuse the runtime installed by @testcontainers/postgresql without relying on a host Redis.
const requireFromTestcontainers = createRequire(import.meta.resolve('@testcontainers/postgresql'));
const { GenericContainer } = requireFromTestcontainers('testcontainers') as {
  GenericContainer: new (image: string) => {
    withExposedPorts(port: number): { start(): Promise<{
      getHost(): string;
      getMappedPort(port: number): number;
      stop(): Promise<unknown>;
    }> };
  };
};

let redis: Awaited<ReturnType<ReturnType<InstanceType<typeof GenericContainer>['withExposedPorts']>['start']>> | undefined;
let first: TestApp | undefined;
let second: TestApp | undefined;

beforeAll(async () => {
  redis = await new GenericContainer('redis:7-alpine').withExposedPorts(6379).start();
  const redisUrl = `redis://${redis.getHost()}:${redis.getMappedPort(6379)}`;
  first = await startTestApp({ redisUrl });
  second = await startTestApp({ redisUrl });
}, 120_000);

afterAll(async () => {
  try {
    await second?.app.close();
    await first?.app.close();
  } finally {
    await redis?.stop();
  }
});

describe('Socket.IO com Redis entre réplicas', () => {
  it('entrega mensagens internas entre sockets conectados a instâncias distintas', async () => {
    if (!first || !second) throw new Error('Aplicações de teste indisponíveis');
    const anaLogin = await login(first.baseUrl, demoAccounts.ana, demoPassword);
    const sofiaLogin = await login(second.baseUrl, demoAccounts.sofia, demoPassword);
    const ana = connectSocket(first.baseUrl, '/agent', anaLogin.token);
    const sofia = connectSocket(second.baseUrl, '/supervisor', sofiaLogin.token);
    await Promise.all([waitConnect(ana), waitConnect(sofia)]);
    expect(internalListAckSchema.parse(await emitAck(ana, 'internal.list', {})).ok).toBe(true);
    expect(internalListAckSchema.parse(await emitAck(sofia, 'internal.list', {})).ok).toBe(true);
    const incoming = waitEvent(sofia, 'internal.message.new');
    const requestId = randomUUID();
    const sent = messageSendAckSchema.parse(await emitAck(ana, 'internal.message.send', {
      conversationId: demoIds.directAnaSofia,
      requestId,
      body: 'mensagem entre réplicas',
    }));
    expect(sent.ok).toBe(true);
    expect(internalMessageSchema.parse(await incoming).requestId).toBe(requestId);
  });

  it('logout em uma réplica desconecta a mesma sessão na outra', async () => {
    if (!first || !second) throw new Error('Aplicações de teste indisponíveis');
    const session = await login(first.baseUrl, demoAccounts.ana, demoPassword);
    const socket = connectSocket(second.baseUrl, '/agent', session.token);
    await waitConnect(socket);
    expect(internalListAckSchema.parse(await emitAck(socket, 'internal.list', {})).ok).toBe(true);
    const disconnected = waitEvent(socket, 'disconnect');
    expect((await postJson(`${first.baseUrl}/auth/logout`, {}, session.token)).status).toBe(200);
    await disconnected;
    expect(socket.connected).toBe(false);
  });
});
