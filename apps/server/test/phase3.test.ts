import {
  conversationAckSchema,
  conversationCloseAckSchema,
  conversationListAckSchema,
  historySyncAckSchema,
  messageReadAckSchema,
  messageRecordSchema,
  presenceAckSchema,
  presenceUpdatedSchema,
  surveyRequiredSchema,
  type PresenceUpdated,
} from '@viavoip/protocol';
import { randomUUID } from 'node:crypto';
import type { Socket } from 'socket.io-client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withTenant } from '../src/db/tenant.js';
import { demoAccounts, demoIds, demoPassword, demoSites } from '../src/demo/ids.js';
import {
  connectSocket,
  emitAck,
  login,
  openVisitor,
  sendMessage,
  startConversation,
  startTestApp,
  syncHistory,
  type TestApp,
  waitConnect,
} from './helpers.js';

let app: TestApp;

beforeAll(async () => {
  app = await startTestApp();
});

afterAll(async () => {
  await app.app.close();
});

describe('filas e isolamento', () => {
  it('mostra ao agente só as filas e os contatos autorizados', async () => {
    const salesVisitor = await openVisitor(app.baseUrl, demoSites.a);
    const sales = await startConversation(salesVisitor.socket, demoIds.queueSalesA);
    const brunoLogin = await login(app.baseUrl, demoAccounts.bruno, demoPassword);
    const anaLogin = await login(app.baseUrl, demoAccounts.ana, demoPassword);
    const bruno = connectSocket(app.baseUrl, '/agent', brunoLogin.token);
    const ana = connectSocket(app.baseUrl, '/agent', anaLogin.token);
    await waitConnect(bruno);
    await waitConnect(ana);

    const brunoList = conversationListAckSchema.parse(await emitAck(bruno, 'queue.subscribe', {}));
    const anaList = conversationListAckSchema.parse(await emitAck(ana, 'queue.subscribe', {}));
    expect(brunoList.ok).toBe(true);
    expect(anaList.ok).toBe(true);
    if (brunoList.ok) {
      expect(brunoList.conversations.some((item) => item.id === sales.conversation.id)).toBe(false);
      expect(brunoList.conversations.every((item) => item.queueId === demoIds.queueSupportA)).toBe(true);
    }
    if (anaList.ok) {
      expect(anaList.conversations.some((item) => item.id === sales.conversation.id && item.queueId === demoIds.queueSalesA)).toBe(true);
    }

    salesVisitor.socket.disconnect();
    bruno.disconnect();
    ana.disconnect();
  });

  it('mantém o contato na fila quando o socket do visitante cai', async () => {
    const visitor = await openVisitor(app.baseUrl, demoSites.a);
    const started = await startConversation(visitor.socket, demoIds.queueSupportA, 'Marina');
    visitor.socket.disconnect();
    const anaLogin = await login(app.baseUrl, demoAccounts.ana, demoPassword);
    const ana = connectSocket(app.baseUrl, '/agent', anaLogin.token);
    await waitConnect(ana);
    const list = conversationListAckSchema.parse(await emitAck(ana, 'queue.subscribe', {}));
    expect(list.ok).toBe(true);
    if (list.ok) {
      const found = list.conversations.find((item) => item.id === started.conversation.id);
      expect(found?.status).toBe('queued');
      expect(found?.queueId).toBe(demoIds.queueSupportA);
      expect(found?.visitorDisplayName).toBe('Marina');
      expect(found?.queuedAt).toBeTruthy();
    }
    ana.disconnect();
  });
});

describe('claim concorrente e vários atendimentos', () => {
  it('entrega o mesmo contato a um único agente', async () => {
    const visitor = await openVisitor(app.baseUrl, demoSites.a);
    const started = await startConversation(visitor.socket, demoIds.queueSupportA);
    const anaLogin = await login(app.baseUrl, demoAccounts.ana, demoPassword);
    const brunoLogin = await login(app.baseUrl, demoAccounts.bruno, demoPassword);
    const ana = connectSocket(app.baseUrl, '/agent', anaLogin.token);
    const bruno = connectSocket(app.baseUrl, '/agent', brunoLogin.token);
    const anaReady = nextPresence(ana, demoIds.agentAna, 'available');
    const brunoReady = nextPresence(bruno, demoIds.agentBruno, 'available');
    await waitConnect(ana);
    await waitConnect(bruno);
    await anaReady;
    await brunoReady;

    const [first, second] = await Promise.all([
      emitAck(ana, 'conversation.claim', { conversationId: started.conversation.id }),
      emitAck(bruno, 'conversation.claim', { conversationId: started.conversation.id }),
    ]);
    const acks = [conversationAckSchema.parse(first), conversationAckSchema.parse(second)];
    const winners = acks.filter((ack) => ack.ok);
    const losers = acks.filter((ack) => !ack.ok);
    expect(winners).toHaveLength(1);
    expect(losers).toHaveLength(1);
    if (!losers[0]?.ok) expect(losers[0]?.error.code).toBe('already_claimed');
    const history = await syncHistory(visitor.socket, started.conversation.id);
    expect(history.conversation.status).toBe('assigned');
    expect([demoIds.agentAna, demoIds.agentBruno]).toContain(history.conversation.agentId);
    await release(ana, started.conversation.id);
    await release(bruno, started.conversation.id);

    visitor.socket.disconnect();
    ana.disconnect();
    bruno.disconnect();
  });

  it('mantém mensagens na conversa certa e entrega a não selecionada no socket', async () => {
    const firstVisitor = await openVisitor(app.baseUrl, demoSites.a);
    const secondVisitor = await openVisitor(app.baseUrl, demoSites.a);
    const first = await startConversation(firstVisitor.socket, demoIds.queueSupportA);
    const second = await startConversation(secondVisitor.socket, demoIds.queueSupportA);
    const anaLogin = await login(app.baseUrl, demoAccounts.ana, demoPassword);
    const ana = connectSocket(app.baseUrl, '/agent', anaLogin.token);
    await waitConnect(ana);
    expect((await claim(ana, first.conversation.id)).ok).toBe(true);
    expect((await claim(ana, second.conversation.id)).ok).toBe(true);

    const incoming = nextMessage(ana, second.conversation.id);
    const sent = await sendMessage(secondVisitor.socket, second.conversation.id, randomUUID(), 'ainda aqui');
    expect(sent.ok).toBe(true);
    const delivered = await incoming;
    expect(delivered.body).toBe('ainda aqui');
    expect(delivered.conversationId).toBe(second.conversation.id);

    const firstHistory = await syncHistory(ana, first.conversation.id);
    const secondHistory = await syncHistory(ana, second.conversation.id);
    expect(firstHistory.messages.some((item) => item.body === 'ainda aqui')).toBe(false);
    expect(secondHistory.messages.some((item) => item.body === 'ainda aqui')).toBe(true);

    const read = messageReadAckSchema.parse(
      await emitAck(ana, 'message.read', { conversationId: second.conversation.id, messageId: delivered.id }),
    );
    expect(read.ok && read.advanced).toBe(true);
    const repeated = messageReadAckSchema.parse(
      await emitAck(ana, 'message.read', { conversationId: second.conversation.id, messageId: delivered.id }),
    );
    expect(repeated.ok && repeated.advanced).toBe(false);
    await release(ana, first.conversation.id);
    await release(ana, second.conversation.id);

    firstVisitor.socket.disconnect();
    secondVisitor.socket.disconnect();
    ana.disconnect();
  });

  it('recusa assumir acima do limite e quando o agente está ausente', async () => {
    const anaLogin = await login(app.baseUrl, demoAccounts.ana, demoPassword);
    const ana = connectSocket(app.baseUrl, '/agent', anaLogin.token);
    await waitConnect(ana);
    const away = presenceAckSchema.parse(await emitAck(ana, 'presence.set', { status: 'away' }));
    expect(away.ok && away.status).toBe('away');
    const visitor = await openVisitor(app.baseUrl, demoSites.a);
    const started = await startConversation(visitor.socket, demoIds.queueSupportA);
    const blocked = await claim(ana, started.conversation.id);
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.error.code).toBe('invalid_state');
    const back = presenceAckSchema.parse(await emitAck(ana, 'presence.set', { status: 'available' }));
    expect(back.ok).toBe(true);

    const active = await withTenant(app.pool, demoIds.tenantA, (client) =>
      client.query<{ total: number }>(
        `SELECT count(*)::int AS total FROM conversations WHERE agent_id = $1 AND status = 'assigned'`,
        [demoIds.agentAna],
      ),
    );
    const total = active.rows[0]?.total ?? 0;
    await withTenant(app.pool, demoIds.tenantA, (client) =>
      client.query(`UPDATE tenants SET max_concurrent_assignments = $2 WHERE id = $1`, [
        demoIds.tenantA,
        Math.max(1, total),
      ]),
    );
    let claimedStarted = false;
    try {
      const extra = await openVisitor(app.baseUrl, demoSites.a);
      const queued = await startConversation(extra.socket, demoIds.queueSupportA);
      if (total === 0) {
        expect((await claim(ana, started.conversation.id)).ok).toBe(true);
        claimedStarted = true;
        const limited = await claim(ana, queued.conversation.id);
        expect(limited.ok).toBe(false);
        if (!limited.ok) expect(limited.error.code).toBe('capacity');
      } else {
        const limited = await claim(ana, queued.conversation.id);
        expect(limited.ok).toBe(false);
        if (!limited.ok) expect(limited.error.code).toBe('capacity');
      }
      extra.socket.disconnect();
    } finally {
      if (claimedStarted) await release(ana, started.conversation.id);
      await withTenant(app.pool, demoIds.tenantA, (client) =>
        client.query(`UPDATE tenants SET max_concurrent_assignments = 3 WHERE id = $1`, [demoIds.tenantA]),
      );
    }

    visitor.socket.disconnect();
    ana.disconnect();
  });
});

describe('transferência, encerramento e reconexão', () => {
  it('transfere sem perder histórico e sem abrir pesquisa', async () => {
    const visitor = await openVisitor(app.baseUrl, demoSites.a);
    const started = await startConversation(visitor.socket, demoIds.queueSupportA);
    const sent = await sendMessage(visitor.socket, started.conversation.id, randomUUID(), 'antes da fila');
    expect(sent.ok).toBe(true);
    const anaLogin = await login(app.baseUrl, demoAccounts.ana, demoPassword);
    const brunoLogin = await login(app.baseUrl, demoAccounts.bruno, demoPassword);
    const ana = connectSocket(app.baseUrl, '/agent', anaLogin.token);
    const bruno = connectSocket(app.baseUrl, '/agent', brunoLogin.token);
    await waitConnect(ana);
    await waitConnect(bruno);
    expect((await claim(ana, started.conversation.id)).ok).toBe(true);

    let survey = false;
    visitor.socket.on('survey.required', () => {
      survey = true;
    });
    const moved = await transfer(ana, started.conversation.id, demoIds.queueSalesA);
    expect(moved.ok).toBe(true);
    if (moved.ok) {
      expect(moved.conversation.queueId).toBe(demoIds.queueSalesA);
      expect(moved.conversation.status).toBe('queued');
      expect(moved.conversation.agentId).toBeNull();
    }
    const denied = await transfer(bruno, started.conversation.id, demoIds.queueSalesA);
    expect(denied.ok).toBe(false);
    const history = await syncHistory(visitor.socket, started.conversation.id);
    expect(history.messages.some((item) => item.body === 'antes da fila')).toBe(true);
    expect(history.events.filter((event) => event.type === 'transferred')).toHaveLength(1);
    expect(history.survey).toBeNull();
    expect(survey).toBe(false);

    const again = await claim(ana, started.conversation.id);
    expect(again.ok).toBe(true);
    const released = await release(ana, started.conversation.id);
    expect(released.ok).toBe(true);
    if (released.ok) expect(released.conversation.status).toBe('queued');
    const afterRelease = await syncHistory(visitor.socket, started.conversation.id);
    expect(afterRelease.survey).toBeNull();
    expect(afterRelease.events.some((event) => event.type === 'released')).toBe(true);

    visitor.socket.disconnect();
    ana.disconnect();
    bruno.disconnect();
  });

  it('exige classificação, abre a pesquisa e não repete o encerramento', async () => {
    const visitor = await openVisitor(app.baseUrl, demoSites.a);
    const started = await startConversation(visitor.socket, demoIds.queueSupportA);
    const anaLogin = await login(app.baseUrl, demoAccounts.ana, demoPassword);
    const ana = connectSocket(app.baseUrl, '/agent', anaLogin.token);
    await waitConnect(ana);
    expect((await claim(ana, started.conversation.id)).ok).toBe(true);
    const missing = conversationCloseAckSchema.parse(
      await emitAck(ana, 'conversation.close', { conversationId: started.conversation.id }),
    );
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.error.code).toBe('invalid_payload');

    const surveyEvent = nextSurvey(visitor.socket, started.conversation.id);
    const closedCalls = () => app.sm.calls.filter(
      (call) => call.method === 'onConversationClosed' && call.input.conversationId === started.conversation.id,
    ).length;
    const before = closedCalls();
    const closed = conversationCloseAckSchema.parse(
      await emitAck(ana, 'conversation.close', {
        conversationId: started.conversation.id,
        dispositionId: demoIds.dispositionResolvedA,
      }),
    );
    expect(closed.ok).toBe(true);
    if (closed.ok) expect(closed.conversation.status).toBe('awaiting_survey');
    const prompt = await surveyEvent;
    expect(prompt.survey.prompt.length).toBeGreaterThan(0);
    const repeated = conversationCloseAckSchema.parse(
      await emitAck(ana, 'conversation.close', {
        conversationId: started.conversation.id,
        dispositionId: demoIds.dispositionResolvedA,
      }),
    );
    expect(repeated.ok).toBe(true);
    expect(closedCalls()).toBe(before + 1);
    const history = await syncHistory(visitor.socket, started.conversation.id);
    expect(history.events.filter((event) => event.type === 'classified')).toHaveLength(1);
    expect(history.survey).not.toBeNull();
    const late = await sendMessage(visitor.socket, started.conversation.id, randomUUID(), 'tarde');
    expect(late.ok).toBe(false);
    if (!late.ok) expect(late.error.code).toBe('invalid_state');

    visitor.socket.disconnect();
    ana.disconnect();
  });

  it('recupera a sessão depois da queda e não deixa o outro agente ler o atendimento', async () => {
    const visitor = await openVisitor(app.baseUrl, demoSites.a);
    const started = await startConversation(visitor.socket, demoIds.queueSupportA);
    const anaLogin = await login(app.baseUrl, demoAccounts.ana, demoPassword);
    const brunoLogin = await login(app.baseUrl, demoAccounts.bruno, demoPassword);
    const carlaLogin = await login(app.baseUrl, demoAccounts.carla, demoPassword);
    const ana = connectSocket(app.baseUrl, '/agent', anaLogin.token);
    await waitConnect(ana);
    expect((await claim(ana, started.conversation.id)).ok).toBe(true);
    const during = await syncHistory(visitor.socket, started.conversation.id);
    expect(during.conversation.status).toBe('assigned');
    ana.disconnect();

    const anaAgain = connectSocket(app.baseUrl, '/agent', anaLogin.token);
    await waitConnect(anaAgain);
    const recovered = await syncHistory(anaAgain, started.conversation.id);
    expect(recovered.conversation.status).toBe('assigned');
    expect(recovered.conversation.agentId).toBe(demoIds.agentAna);
    const reply = await sendMessage(anaAgain, started.conversation.id, randomUUID(), 'voltei');
    expect(reply.ok).toBe(true);

    const bruno = connectSocket(app.baseUrl, '/agent', brunoLogin.token);
    const carla = connectSocket(app.baseUrl, '/agent', carlaLogin.token);
    await waitConnect(bruno);
    await waitConnect(carla);
    const foreignAgent = await syncHistorySafe(bruno, started.conversation.id);
    expect(foreignAgent.ok).toBe(false);
    if (!foreignAgent.ok) expect(foreignAgent.error.code).toBe('forbidden');
    const foreignTenant = await syncHistorySafe(carla, started.conversation.id);
    expect(foreignTenant.ok).toBe(false);
    if (!foreignTenant.ok) expect(foreignTenant.error.code).toBe('not_found');
    await release(anaAgain, started.conversation.id);

    visitor.socket.disconnect();
    anaAgain.disconnect();
    bruno.disconnect();
    carla.disconnect();
  });

  it('aceita só uma de duas ações conflitantes e ignora a repetição', async () => {
    const visitor = await openVisitor(app.baseUrl, demoSites.a);
    const started = await startConversation(visitor.socket, demoIds.queueSupportA);
    const anaLogin = await login(app.baseUrl, demoAccounts.ana, demoPassword);
    const ana = connectSocket(app.baseUrl, '/agent', anaLogin.token);
    await waitConnect(ana);
    expect((await claim(ana, started.conversation.id)).ok).toBe(true);
    const [closed, moved] = await Promise.all([
      emitAck(ana, 'conversation.close', {
        conversationId: started.conversation.id,
        dispositionId: demoIds.dispositionUnresolvedA,
      }),
      emitAck(ana, 'conversation.transfer', {
        conversationId: started.conversation.id,
        queueId: demoIds.queueSalesA,
      }),
    ]);
    const closeAck = conversationCloseAckSchema.parse(closed);
    const transferAck = conversationAckSchema.parse(moved);
    const successes = Number(closeAck.ok) + Number(transferAck.ok);
    expect(successes).toBe(1);
    const history = await syncHistory(visitor.socket, started.conversation.id);
    const classified = history.events.filter((event) => event.type === 'classified').length;
    const transferred = history.events.filter((event) => event.type === 'transferred').length;
    expect(classified + transferred).toBe(1);

    visitor.socket.disconnect();
    ana.disconnect();
  });
});

describe('presença com mais de uma conexão', () => {
  it('não publica offline quando só uma aba fecha e expira quando o heartbeat envelhece', async () => {
    const anaLogin = await login(app.baseUrl, demoAccounts.ana, demoPassword);
    const first = connectSocket(app.baseUrl, '/agent', anaLogin.token);
    const second = connectSocket(app.baseUrl, '/agent', anaLogin.token);
    const firstReady = nextPresence(first, demoIds.agentAna, 'available');
    await waitConnect(first);
    await waitConnect(second);
    await firstReady;
    let sawOffline = false;
    second.on('presence.updated', (payload: unknown) => {
      const parsed = presenceUpdatedSchema.safeParse(payload);
      if (parsed.success && parsed.data.agentId === demoIds.agentAna && parsed.data.status === 'offline') {
        sawOffline = true;
      }
    });
    first.disconnect();
    await waitUntil(async () => (await connectionCount(demoIds.agentAna)) === 1);
    expect(sawOffline).toBe(false);
    const heartbeat = presenceAckSchema.parse(await emitAck(second, 'presence.heartbeat', {}));
    expect(heartbeat.ok && heartbeat.status).not.toBe('offline');

    await withTenant(app.pool, demoIds.tenantA, (client) =>
      client.query(
        `UPDATE agent_connections
         SET last_heartbeat_at = now() - interval '2 minutes'
         WHERE agent_id = $1`,
        [demoIds.agentAna],
      ),
    );
    const offline = nextPresence(second, demoIds.agentAna, 'offline');
    await app.sweepPresence();
    await offline;

    second.disconnect();
  });
});

async function claim(socket: Socket, conversationId: string) {
  return conversationAckSchema.parse(await emitAck(socket, 'conversation.claim', { conversationId }));
}

async function release(socket: Socket, conversationId: string) {
  return conversationAckSchema.parse(await emitAck(socket, 'conversation.release', { conversationId }));
}

async function transfer(socket: Socket, conversationId: string, queueId: string) {
  return conversationAckSchema.parse(
    await emitAck(socket, 'conversation.transfer', { conversationId, queueId }),
  );
}

async function syncHistorySafe(socket: Socket, conversationId: string) {
  return historySyncAckSchema.parse(await emitAck(socket, 'history.sync', { conversationId }));
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

function nextMessage(socket: Socket, conversationId: string) {
  return new Promise<ReturnType<typeof messageRecordSchema.parse>>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('mensagem não chegou')), 5000);
    const onMessage = (payload: unknown) => {
      const parsed = messageRecordSchema.safeParse(payload);
      if (!parsed.success || parsed.data.conversationId !== conversationId) return;
      clearTimeout(timer);
      socket.off('message.new', onMessage);
      resolve(parsed.data);
    };
    socket.on('message.new', onMessage);
  });
}

function nextSurvey(socket: Socket, conversationId: string) {
  return new Promise<ReturnType<typeof surveyRequiredSchema.parse>>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('pesquisa não chegou')), 5000);
    const onSurvey = (payload: unknown) => {
      const parsed = surveyRequiredSchema.safeParse(payload);
      if (!parsed.success || parsed.data.conversationId !== conversationId) return;
      clearTimeout(timer);
      socket.off('survey.required', onSurvey);
      resolve(parsed.data);
    };
    socket.on('survey.required', onSurvey);
  });
}

async function connectionCount(agentId: string): Promise<number> {
  const result = await withTenant(app.pool, demoIds.tenantA, (client) =>
    client.query<{ total: number }>(
      `SELECT count(*)::int AS total FROM agent_connections WHERE agent_id = $1`,
      [agentId],
    ),
  );
  return result.rows[0]?.total ?? 0;
}

async function waitUntil(ready: () => Promise<boolean>): Promise<void> {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    if (await ready()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('condição não convergiu');
}
