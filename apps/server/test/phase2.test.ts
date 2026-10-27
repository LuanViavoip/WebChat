import {
  conversationAckSchema,
  conversationSnapshotAckSchema,
  historySyncAckSchema,
  presenceUpdatedSchema,
  publicWidgetSchema,
  queuePositionSchema,
  type PresenceUpdated,
  type QueuePosition,
} from '@viavoip/protocol';
import { randomUUID } from 'node:crypto';
import type { Socket } from 'socket.io-client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withTenant } from '../src/db/tenant.js';
import { demoAccounts, demoIds, demoPassword, demoSites } from '../src/demo/ids.js';
import {
  connectSocket,
  demoParentOrigin,
  emitAck,
  login,
  openVisitor,
  postJson,
  sendMessage,
  startConversation,
  startTestApp,
  syncHistory,
  type TestApp,
  waitConnect,
} from './helpers.js';

let app: TestApp;
let limited: TestApp;

beforeAll(async () => {
  app = await startTestApp();
  limited = await startTestApp({ sessionCreateLimit: 2, messageLimit: 2 });
});

afterAll(async () => {
  await app.app.close();
  await limited.app.close();
});

describe('configuração pública e origem', () => {
  it('entrega a configuração do site sem token e sem filas de outro tenant', async () => {
    const siteA = await readWidget(app.baseUrl, demoSites.a);
    expect(siteA.queues.map((queue) => queue.id).sort()).toEqual(
      [demoIds.queueSupportA, demoIds.queueSalesA].sort(),
    );
    expect(siteA.welcomeMessage).toContain('Site A');
    expect(siteA.primaryColor).toBe('#0c7c73');
    expect(siteA.acceptingChats).toBe(true);
    expect(JSON.stringify(siteA)).not.toContain('token');

    const siteB = await readWidget(app.baseUrl, demoSites.b);
    expect(siteB.queues.map((queue) => queue.id).sort()).toEqual(
      [demoIds.queueSupportB, demoIds.queueSalesB].sort(),
    );
    expect(siteB.welcomeMessage).toContain('Site B');
    expect(siteB.primaryColor).toBe('#1d4e89');
  });

  it('recusa criar sessão quando a origem não está na allowlist', async () => {
    const rejected = await postJson(`${app.baseUrl}/visitor/sessions`, {
      sitePublicId: demoSites.a,
      parentOrigin: 'http://evil.example',
    });
    expect(rejected.status).toBe(403);
  });
});

describe('fila, devolução e transferência', () => {
  it('informa a posição e permite sair da fila', async () => {
    const first = await openVisitor(app.baseUrl, demoSites.a);
    const firstPosition = nextPosition(first.socket, '');
    const started = await startConversation(first.socket, demoIds.queueSupportA);
    const opening = await firstPosition.then((position) => position);
    expect(opening.conversationId).toBe(started.conversation.id);
    expect(opening.position).toBeGreaterThanOrEqual(1);

    const second = await openVisitor(app.baseUrl, demoSites.a);
    const secondPosition = nextPosition(second.socket, '');
    const other = await startConversation(second.socket, demoIds.queueSupportA);
    const queued = await secondPosition;
    expect(queued.conversationId).toBe(other.conversation.id);
    expect(queued.position).toBeGreaterThan(opening.position);

    const leftAck = conversationAckSchema.parse(
      await emitAck(second.socket, 'conversation.leave', { conversationId: other.conversation.id }),
    );
    expect(leftAck.ok).toBe(true);
    if (leftAck.ok) expect(leftAck.conversation.status).toBe('closed');
    const history = await syncHistory(second.socket, other.conversation.id);
    expect(history.events.some((event) => event.type === 'left')).toBe(true);
    expect(history.survey).toBeNull();

    first.socket.disconnect();
    second.socket.disconnect();
  });

  it('só o agente dono devolve a conversa e a queda não encerra o atendimento', async () => {
    const visitor = await openVisitor(app.baseUrl, demoSites.a);
    const started = await startConversation(visitor.socket, demoIds.queueSupportA);
    const anaLogin = await login(app.baseUrl, demoAccounts.ana, demoPassword);
    const brunoLogin = await login(app.baseUrl, demoAccounts.bruno, demoPassword);
    const ana = connectSocket(app.baseUrl, '/agent', anaLogin.token);
    const anaOnline = nextPresence(ana, demoIds.agentAna, 'available');
    await waitConnect(ana);
    await anaOnline;
    const bruno = connectSocket(app.baseUrl, '/agent', brunoLogin.token);
    await waitConnect(bruno);

    const claim = conversationAckSchema.parse(
      await emitAck(ana, 'conversation.claim', { conversationId: started.conversation.id }),
    );
    expect(claim.ok).toBe(true);

    const brunoRelease = conversationAckSchema.parse(
      await emitAck(bruno, 'conversation.release', { conversationId: started.conversation.id }),
    );
    expect(brunoRelease.ok).toBe(false);
    if (!brunoRelease.ok) expect(brunoRelease.error.code).toBe('forbidden');

    const anaOffline = nextPresence(bruno, demoIds.agentAna, 'offline');
    ana.disconnect();
    await anaOffline;
    const duringDrop = await syncHistory(visitor.socket, started.conversation.id);
    expect(duringDrop.conversation.status).toBe('assigned');
    expect(duringDrop.conversation.agentId).toBe(demoIds.agentAna);

    const anaAgain = connectSocket(app.baseUrl, '/agent', anaLogin.token);
    await waitConnect(anaAgain);
    const released = conversationAckSchema.parse(
      await emitAck(anaAgain, 'conversation.release', { conversationId: started.conversation.id }),
    );
    expect(released.ok).toBe(true);
    if (released.ok) {
      expect(released.conversation.status).toBe('queued');
      expect(released.conversation.agentId).toBeNull();
    }
    expect(app.sm.calls.some((call) => call.method === 'onConversationReleased')).toBe(true);
    const secondRelease = conversationAckSchema.parse(
      await emitAck(anaAgain, 'conversation.release', { conversationId: started.conversation.id }),
    );
    expect(secondRelease.ok).toBe(false);
    if (!secondRelease.ok) expect(secondRelease.error.code).toBe('invalid_state');

    visitor.socket.disconnect();
    bruno.disconnect();
    anaAgain.disconnect();
  });

  it('transfere para uma fila do mesmo tenant e recusa a fila de outro', async () => {
    const visitor = await openVisitor(app.baseUrl, demoSites.a);
    const started = await startConversation(visitor.socket, demoIds.queueSupportA);
    const anaLogin = await login(app.baseUrl, demoAccounts.ana, demoPassword);
    const ana = connectSocket(app.baseUrl, '/agent', anaLogin.token);
    await waitConnect(ana);
    const claim = conversationAckSchema.parse(
      await emitAck(ana, 'conversation.claim', { conversationId: started.conversation.id }),
    );
    expect(claim.ok).toBe(true);

    const carlaLogin = await login(app.baseUrl, demoAccounts.carla, demoPassword);
    const carla = connectSocket(app.baseUrl, '/agent', carlaLogin.token);
    await waitConnect(carla);
    const foreign = conversationAckSchema.parse(
      await emitAck(carla, 'conversation.transfer', {
        conversationId: started.conversation.id,
        queueId: demoIds.queueSupportB,
      }),
    );
    expect(foreign.ok).toBe(false);
    if (!foreign.ok) expect(foreign.error.code).toBe('not_found');

    const wrongQueue = conversationAckSchema.parse(
      await emitAck(ana, 'conversation.transfer', {
        conversationId: started.conversation.id,
        queueId: demoIds.queueSupportB,
      }),
    );
    expect(wrongQueue.ok).toBe(false);
    if (!wrongQueue.ok) expect(wrongQueue.error.code).toBe('not_found');

    const moved = conversationAckSchema.parse(
      await emitAck(ana, 'conversation.transfer', {
        conversationId: started.conversation.id,
        queueId: demoIds.queueSalesA,
      }),
    );
    expect(moved.ok).toBe(true);
    if (moved.ok) {
      expect(moved.conversation.queueId).toBe(demoIds.queueSalesA);
      expect(moved.conversation.status).toBe('queued');
    }
    expect(app.sm.calls.some((call) => call.method === 'onConversationTransferred')).toBe(true);

    visitor.socket.disconnect();
    ana.disconnect();
    carla.disconnect();
  });

  it('recupera eventos posteriores ao cursor e rejeita caractere nulo', async () => {
    const visitor = await openVisitor(app.baseUrl, demoSites.a);
    const started = await startConversation(visitor.socket, demoIds.queueSupportA);
    const full = await syncHistory(visitor.socket, started.conversation.id);
    const queued = full.events.find((event) => event.type === 'queued');
    expect(queued).toBeTruthy();

    const anaLogin = await login(app.baseUrl, demoAccounts.ana, demoPassword);
    const ana = connectSocket(app.baseUrl, '/agent', anaLogin.token);
    await waitConnect(ana);
    const claim = conversationAckSchema.parse(
      await emitAck(ana, 'conversation.claim', { conversationId: started.conversation.id }),
    );
    expect(claim.ok).toBe(true);

    const partial = historySyncAckSchema.parse(
      await emitAck(visitor.socket, 'history.sync', {
        conversationId: started.conversation.id,
        afterEventId: queued?.id,
      }),
    );
    expect(partial.ok).toBe(true);
    if (partial.ok) {
      expect(partial.events.some((event) => event.type === 'queued')).toBe(false);
      expect(partial.events.some((event) => event.type === 'assigned')).toBe(true);
    }

    const missing = historySyncAckSchema.parse(
      await emitAck(visitor.socket, 'history.sync', {
        conversationId: started.conversation.id,
        afterEventId: randomUUID(),
      }),
    );
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.error.code).toBe('invalid_payload');

    const nulled = await sendMessage(visitor.socket, started.conversation.id, randomUUID(), 'oi\u0000');
    expect(nulled.ok).toBe(false);
    if (!nulled.ok) expect(nulled.error.code).toBe('invalid_payload');
    await emitAck(ana, 'conversation.release', { conversationId: started.conversation.id });

    visitor.socket.disconnect();
    ana.disconnect();
  });
});

describe('nome, disponibilidade e limite', () => {
  it('exige o nome quando o site pede e recusa fila fechada', async () => {
    await withTenant(app.pool, demoIds.tenantA, (client) =>
      client.query(`UPDATE sites SET require_visitor_name = true WHERE id = $1`, [demoIds.siteA]),
    );
    try {
      const visitor = await openVisitor(app.baseUrl, demoSites.a);
      const missing = conversationSnapshotAckSchema.parse(
        await emitAck(visitor.socket, 'conversation.start', { queueId: demoIds.queueSupportA }),
      );
      expect(missing.ok).toBe(false);
      if (!missing.ok) expect(missing.error.code).toBe('invalid_payload');
      const named = conversationSnapshotAckSchema.parse(
        await emitAck(visitor.socket, 'conversation.start', {
          queueId: demoIds.queueSupportA,
          displayName: 'Marina',
        }),
      );
      expect(named.ok).toBe(true);
      visitor.socket.disconnect();
    } finally {
      await withTenant(app.pool, demoIds.tenantA, (client) =>
        client.query(`UPDATE sites SET require_visitor_name = false WHERE id = $1`, [demoIds.siteA]),
      );
    }

    await withTenant(app.pool, demoIds.tenantA, (client) =>
      client.query(`UPDATE sites SET accepting_chats = false WHERE id = $1`, [demoIds.siteA]),
    );
    try {
      const visitor = await openVisitor(app.baseUrl, demoSites.a);
      const closed = conversationSnapshotAckSchema.parse(
        await emitAck(visitor.socket, 'conversation.start', { queueId: demoIds.queueSupportA }),
      );
      expect(closed.ok).toBe(false);
      if (!closed.ok) expect(closed.error.code).toBe('invalid_state');
      visitor.socket.disconnect();
    } finally {
      await withTenant(app.pool, demoIds.tenantA, (client) =>
        client.query(`UPDATE sites SET accepting_chats = true WHERE id = $1`, [demoIds.siteA]),
      );
    }
  });

  it('limita criação de sessão e envio de mensagem', async () => {
    const first = await openVisitor(limited.baseUrl, demoSites.b);
    const second = await openVisitor(limited.baseUrl, demoSites.b);
    second.socket.disconnect();
    const blocked = await postJson(`${limited.baseUrl}/visitor/sessions`, {
      sitePublicId: demoSites.b,
      parentOrigin: demoParentOrigin,
    });
    expect(blocked.status).toBe(429);

    const started = await startConversation(first.socket, demoIds.queueSupportB);
    const firstMessage = await sendMessage(first.socket, started.conversation.id, randomUUID(), 'um');
    const secondMessage = await sendMessage(first.socket, started.conversation.id, randomUUID(), 'dois');
    const thirdMessage = await sendMessage(first.socket, started.conversation.id, randomUUID(), 'três');
    expect(firstMessage.ok).toBe(true);
    expect(secondMessage.ok).toBe(true);
    expect(thirdMessage.ok).toBe(false);
    if (!thirdMessage.ok) expect(thirdMessage.error.code).toBe('rate_limited');
    first.socket.disconnect();
  });
});

async function readWidget(baseUrl: string, publicId: string) {
  const response = await fetch(`${baseUrl}/public/widgets/${publicId}`);
  expect(response.status).toBe(200);
  return publicWidgetSchema.parse(await response.json());
}

function nextPosition(socket: Socket, conversationId: string): Promise<QueuePosition> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('posição não chegou')), 5000);
    const onPosition = (payload: unknown) => {
      const parsed = queuePositionSchema.safeParse(payload);
      if (!parsed.success) return;
      if (conversationId && parsed.data.conversationId !== conversationId) return;
      clearTimeout(timer);
      socket.off('queue.position', onPosition);
      resolve(parsed.data);
    };
    socket.on('queue.position', onPosition);
  });
}

function nextPresence(socket: Socket, agentId: string, status: PresenceUpdated['status']): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`presença ${status}`)), 5000);
    const onPresence = (payload: unknown) => {
      const parsed = presenceUpdatedSchema.safeParse(payload);
      if (!parsed.success || parsed.data.agentId !== agentId || parsed.data.status !== status) return;
      clearTimeout(timer);
      socket.off('presence.updated', onPresence);
      resolve();
    };
    socket.on('presence.updated', onPresence);
  });
}
