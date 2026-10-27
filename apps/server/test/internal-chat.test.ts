import {
  internalHistoryAckSchema,
  internalListAckSchema,
  internalMessageSchema,
  internalOpenAckSchema,
  messageSendAckSchema,
} from '@viavoip/protocol';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withTenant } from '../src/db/tenant.js';
import { demoAccounts, demoIds, demoPassword } from '../src/demo/ids.js';
import { connectSocket, emitAck, login, startTestApp, waitConnect, waitEvent, type TestApp } from './helpers.js';

let app: TestApp;

beforeAll(async () => {
  app = await startTestApp();
});

afterAll(async () => {
  await app.app.close();
});

describe('chat interno', () => {
  it('abre uma única direta, entrega em tempo real e não duplica o request', async () => {
    const anaLogin = await login(app.baseUrl, demoAccounts.ana, demoPassword);
    const sofiaLogin = await login(app.baseUrl, demoAccounts.sofia, demoPassword);
    const ana = connectSocket(app.baseUrl, '/agent', anaLogin.token);
    const sofia = connectSocket(app.baseUrl, '/supervisor', sofiaLogin.token);
    await Promise.all([waitConnect(ana), waitConnect(sofia)]);
    const first = internalOpenAckSchema.parse(await emitAck(ana, 'internal.open', { peerId: demoIds.supervisorSofia }));
    const second = internalOpenAckSchema.parse(await emitAck(ana, 'internal.open', { peerId: demoIds.supervisorSofia }));
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(second.created).toBe(false);
    expect(second.conversation.id).toBe(first.conversation.id);
    expect(first.conversation.id).toBe(demoIds.directAnaSofia);
    const incoming = waitEvent(sofia, 'internal.message.new');
    const requestId = randomUUID();
    const sent = messageSendAckSchema.parse(
      await emitAck(ana, 'internal.message.send', {
        conversationId: first.conversation.id,
        requestId,
        body: 'Preciso de apoio',
      }),
    );
    expect(sent.ok).toBe(true);
    if (!sent.ok) return;
    const payload = internalMessageSchema.parse(await incoming);
    expect(payload.body).toBe('Preciso de apoio');
    expect(payload.requestId).toBe(requestId);
    const repeated = messageSendAckSchema.parse(
      await emitAck(ana, 'internal.message.send', {
        conversationId: first.conversation.id,
        requestId,
        body: 'Preciso de apoio',
      }),
    );
    expect(repeated.ok).toBe(true);
    if (!repeated.ok) return;
    expect(repeated.created).toBe(false);
    expect(repeated.messageId).toBe(sent.messageId);
    ana.disconnect();
    const resumed = connectSocket(app.baseUrl, '/agent', anaLogin.token);
    await waitConnect(resumed);
    const history = internalHistoryAckSchema.parse(
      await emitAck(resumed, 'internal.history', {
        conversationId: first.conversation.id,
        afterMessageId: demoIds.messageDirect,
      }),
    );
    expect(history.ok).toBe(true);
    if (!history.ok) return;
    const copies = history.messages.filter((message) => message.requestId === requestId);
    expect(copies).toHaveLength(1);
    resumed.disconnect();
    sofia.disconnect();
  });

  it('entrega o grupo, pagina o histórico e corta a leitura depois da saída', async () => {
    const sofiaLogin = await login(app.baseUrl, demoAccounts.sofia, demoPassword);
    const anaLogin = await login(app.baseUrl, demoAccounts.ana, demoPassword);
    const sofia = connectSocket(app.baseUrl, '/supervisor', sofiaLogin.token);
    const ana = connectSocket(app.baseUrl, '/agent', anaLogin.token);
    await Promise.all([waitConnect(sofia), waitConnect(ana)]);
    const bodies = ['um', 'dois', 'três'];
    for (const body of bodies) {
      const sent = messageSendAckSchema.parse(
        await emitAck(ana, 'internal.message.send', {
          conversationId: demoIds.groupSupportA,
          requestId: randomUUID(),
          body,
        }),
      );
      expect(sent.ok).toBe(true);
    }
    const page = internalHistoryAckSchema.parse(
      await emitAck(ana, 'internal.history', { conversationId: demoIds.groupSupportA, limit: 2 }),
    );
    expect(page.ok).toBe(true);
    if (!page.ok) return;
    expect(page.messages.map((message) => message.body)).toEqual(['dois', 'três']);
    const older = internalHistoryAckSchema.parse(
      await emitAck(ana, 'internal.history', {
        conversationId: demoIds.groupSupportA,
        beforeMessageId: page.messages[0]?.id,
        limit: 2,
      }),
    );
    expect(older.ok).toBe(true);
    if (!older.ok) return;
    expect(older.messages.map((message) => message.body)).toContain('um');
    try {
      const removed = await emitAck(sofia, 'sector.member.remove', {
        sectorId: demoIds.sectorSupportA,
        agentId: demoIds.agentAna,
      });
      expect(removed).toMatchObject({ ok: true });
      const blocked = messageSendAckSchema.parse(
        await emitAck(ana, 'internal.message.send', {
          conversationId: demoIds.groupSupportA,
          requestId: randomUUID(),
          body: 'não posso mais',
        }),
      );
      expect(blocked.ok).toBe(false);
      const after = messageSendAckSchema.parse(
        await emitAck(sofia, 'internal.message.send', {
          conversationId: demoIds.groupSupportA,
          requestId: randomUUID(),
          body: 'mensagem posterior',
        }),
      );
      expect(after.ok).toBe(true);
      const visible = internalHistoryAckSchema.parse(
        await emitAck(ana, 'internal.history', { conversationId: demoIds.groupSupportA, limit: 20 }),
      );
      expect(visible.ok).toBe(true);
      if (!visible.ok) return;
      expect(visible.messages.map((message) => message.body)).toContain('um');
      expect(visible.messages.map((message) => message.body)).not.toContain('mensagem posterior');
    } finally {
      await emitAck(sofia, 'sector.member.add', { sectorId: demoIds.sectorSupportA, agentId: demoIds.agentAna });
      ana.disconnect();
      sofia.disconnect();
    }
  });

  it('recusa direta entre agentes, conversa de terceiro e outro tenant', async () => {
    const anaLogin = await login(app.baseUrl, demoAccounts.ana, demoPassword);
    const brunoLogin = await login(app.baseUrl, demoAccounts.bruno, demoPassword);
    const carlaLogin = await login(app.baseUrl, demoAccounts.carla, demoPassword);
    const ana = connectSocket(app.baseUrl, '/agent', anaLogin.token);
    const bruno = connectSocket(app.baseUrl, '/agent', brunoLogin.token);
    const carla = connectSocket(app.baseUrl, '/agent', carlaLogin.token);
    await Promise.all([waitConnect(ana), waitConnect(bruno), waitConnect(carla)]);
    const peers = internalOpenAckSchema.parse(await emitAck(ana, 'internal.open', { peerId: demoIds.agentBruno }));
    expect(peers.ok).toBe(false);
    if (!peers.ok) expect(peers.error.code).toBe('forbidden');
    const foreign = internalOpenAckSchema.parse(await emitAck(carla, 'internal.open', { peerId: demoIds.agentAna }));
    expect(foreign.ok).toBe(false);
    if (!foreign.ok) expect(foreign.error.code).toBe('not_found');
    const hidden = internalHistoryAckSchema.parse(
      await emitAck(bruno, 'internal.history', { conversationId: demoIds.directAnaSofia }),
    );
    expect(hidden.ok).toBe(false);
    if (!hidden.ok) expect(hidden.error.code).toBe('forbidden');
    const listed = internalListAckSchema.parse(await emitAck(bruno, 'internal.list', {}));
    expect(listed.ok).toBe(true);
    if (listed.ok) expect(listed.conversations.map((item) => item.id)).not.toContain(demoIds.directAnaSofia);
    const rows = await withTenant(app.pool, demoIds.tenantB, (client) =>
      client.query(`SELECT id FROM internal_conversations WHERE id = $1`, [demoIds.directAnaSofia]),
    );
    expect(rows.rows).toEqual([]);
    ana.disconnect();
    bruno.disconnect();
    carla.disconnect();
  });
});
