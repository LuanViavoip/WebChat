import { conversationAckSchema, conversationListAckSchema, historySyncAckSchema, internalHistoryAckSchema, supervisorSnapshotAckSchema } from '@viavoip/protocol';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withTenant } from '../src/db/tenant.js';
import { demoAccounts, demoIds, demoPassword, demoSites } from '../src/demo/ids.js';
import {
  connectSocket,
  emitAck,
  login,
  openVisitor,
  startConversation,
  startTestApp,
  waitConnect,
  type TestApp,
} from './helpers.js';

let app: TestApp;

beforeAll(async () => {
  app = await startTestApp();
});

afterAll(async () => {
  await app.app.close();
});

describe('supervisão', () => {
  it('não envia presença de agente da fila sem membresia no setor ao supervisor', async () => {
    await withTenant(app.pool, demoIds.tenantA, (client) =>
      client.query(
        `INSERT INTO agent_queues (agent_id, queue_id, tenant_id)
         VALUES ($1, $2, $3) ON CONFLICT (agent_id, queue_id) DO NOTHING`,
        [demoIds.agentDiana, demoIds.queueSupportA, demoIds.tenantA],
      ),
    );
    const dianaLogin = await login(app.baseUrl, demoAccounts.diana, demoPassword);
    const sofiaLogin = await login(app.baseUrl, demoAccounts.sofia, demoPassword);
    const diana = connectSocket(app.baseUrl, '/agent', dianaLogin.token);
    const sofia = connectSocket(app.baseUrl, '/supervisor', sofiaLogin.token);
    await Promise.all([waitConnect(diana), waitConnect(sofia)]);
    let received = false;
    const onPresence = () => { received = true; };
    sofia.on('presence.updated', onPresence);
    await emitAck(diana, 'presence.set', { status: 'away' });
    await new Promise((resolve) => setTimeout(resolve, 100));
    sofia.off('presence.updated', onPresence);
    expect(received).toBe(false);
    const snapshot = supervisorSnapshotAckSchema.parse(await emitAck(sofia, 'supervisor.snapshot', {}));
    expect(snapshot.ok).toBe(true);
    if (snapshot.ok) expect(snapshot.snapshot.agents.map((agent) => agent.agentId)).not.toContain(demoIds.agentDiana);
    diana.disconnect();
    sofia.disconnect();
    await withTenant(app.pool, demoIds.tenantA, (client) =>
      client.query(`DELETE FROM agent_queues WHERE agent_id = $1 AND queue_id = $2 AND tenant_id = $3`, [
        demoIds.agentDiana,
        demoIds.queueSupportA,
        demoIds.tenantA,
      ]),
    );
  });

  it('restringe listagem, histórico, transferência e eventos à fila do setor', async () => {
    const visitor = await openVisitor(app.baseUrl, demoSites.a);
    const sales = await startConversation(visitor.socket, demoIds.queueSalesA);
    const sofiaLogin = await login(app.baseUrl, demoAccounts.sofia, demoPassword);
    const sofia = connectSocket(app.baseUrl, '/supervisor', sofiaLogin.token);
    await waitConnect(sofia);

    const listed = conversationListAckSchema.parse(await emitAck(sofia, 'conversation.list', {}));
    expect(listed.ok).toBe(true);
    if (listed.ok) expect(listed.conversations.map((item) => item.id)).not.toContain(sales.conversation.id);
    const watched = historySyncAckSchema.parse(
      await emitAck(sofia, 'conversation.watch', { conversationId: sales.conversation.id }),
    );
    expect(watched.ok).toBe(false);
    const transferred = conversationAckSchema.parse(
      await emitAck(sofia, 'conversation.transfer', {
        conversationId: sales.conversation.id,
        queueId: demoIds.queueSupportA,
      }),
    );
    expect(transferred.ok).toBe(false);

    let gotSalesEvent = false;
    const onMessage = () => { gotSalesEvent = true; };
    sofia.on('message.new', onMessage);
    await emitAck(visitor.socket, 'message.send', {
      conversationId: sales.conversation.id,
      requestId: randomUUID(),
      body: 'mensagem da fila comercial',
    });
    await new Promise((resolve) => setTimeout(resolve, 100));
    sofia.off('message.new', onMessage);
    expect(gotSalesEvent).toBe(false);
    visitor.socket.disconnect();
    sofia.disconnect();
  });

  it('calcula indicadores reais e audita a leitura do atendimento', async () => {
    const visitor = await openVisitor(app.baseUrl, demoSites.a);
    const started = await startConversation(visitor.socket, demoIds.queueSupportA, 'Cliente fase 4');
    const sofiaLogin = await login(app.baseUrl, demoAccounts.sofia, demoPassword);
    const sofia = connectSocket(app.baseUrl, '/supervisor', sofiaLogin.token);
    await waitConnect(sofia);
    const snapshot = supervisorSnapshotAckSchema.parse(
      await emitAck(sofia, 'supervisor.snapshot', {
        from: new Date(Date.now() - 60_000).toISOString(),
        to: new Date(Date.now() + 60_000).toISOString(),
      }),
    );
    expect(snapshot.ok).toBe(true);
    if (!snapshot.ok) return;
    expect(snapshot.snapshot.metrics.waiting).toBeGreaterThanOrEqual(1);
    const ana = snapshot.snapshot.agents.find((agent) => agent.agentId === demoIds.agentAna);
    const eduardo = snapshot.snapshot.agents.find((agent) => agent.agentId === demoIds.agentEduardo);
    expect(ana?.sectors).toContain('Suporte Técnico');
    expect(eduardo?.activityName).toBe('Treinamento');
    expect(snapshot.snapshot.agents.map((agent) => agent.agentId)).not.toContain(demoIds.agentCarla);
    const watched = historySyncAckSchema.parse(
      await emitAck(sofia, 'conversation.watch', { conversationId: started.conversation.id }),
    );
    expect(watched.ok).toBe(true);
    const audit = await withTenant(app.pool, demoIds.tenantA, (client) =>
      client.query(
        `SELECT id FROM audit_events
         WHERE actor_id = $1 AND action = 'conversation.watch' AND resource_id = $2`,
        [demoIds.supervisorSofia, started.conversation.id],
      ),
    );
    expect(audit.rows.length).toBeGreaterThan(0);
    const listed = conversationListAckSchema.parse(await emitAck(sofia, 'conversation.list', {}));
    expect(listed.ok).toBe(true);
    if (listed.ok) expect(listed.conversations.map((item) => item.id)).toContain(started.conversation.id);
    visitor.socket.disconnect();
    sofia.disconnect();
  });

  it('nega a direta alheia e o setor de outro supervisor', async () => {
    const helenaLogin = await login(app.baseUrl, demoAccounts.helena, demoPassword);
    const helena = connectSocket(app.baseUrl, '/supervisor', helenaLogin.token);
    await waitConnect(helena);
    const direct = internalHistoryAckSchema.parse(
      await emitAck(helena, 'internal.history', { conversationId: demoIds.directAnaSofia }),
    );
    expect(direct.ok).toBe(false);
    if (!direct.ok) expect(direct.error.code).toBe('forbidden');
    const snapshot = supervisorSnapshotAckSchema.parse(await emitAck(helena, 'supervisor.snapshot', {}));
    expect(snapshot.ok).toBe(true);
    if (!snapshot.ok) return;
    const ids = snapshot.snapshot.agents.map((agent) => agent.agentId);
    expect(ids).toContain(demoIds.agentDiana);
    expect(ids).not.toContain(demoIds.agentBruno);
    helena.disconnect();
  });
});
