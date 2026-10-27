import { conversationAckSchema } from '@viavoip/protocol';
import { randomUUID } from 'node:crypto';
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

describe('reconexão', () => {
  it('recupera o histórico e não duplica a mensagem reenviada', async () => {
    const visitor = await openVisitor(app.baseUrl, demoSites.a);
    const started = await startConversation(visitor.socket, demoIds.queueSupportA);
    const ana = await login(app.baseUrl, demoAccounts.ana, demoPassword);
    const agent = connectSocket(app.baseUrl, '/agent', ana.token);
    let reconnected: ReturnType<typeof connectSocket> | undefined;
    try {
      await waitConnect(agent);
      const claim = conversationAckSchema.parse(
        await emitAck(agent, 'conversation.claim', { conversationId: started.conversation.id }),
      );
      if (!claim.ok) throw new Error(claim.error.message);

      const firstId = randomUUID();
      const secondId = randomUUID();
      const first = await sendMessage(visitor.socket, started.conversation.id, firstId, 'olá');
      await sendMessage(agent, started.conversation.id, secondId, 'oi');
      expect(first.ok).toBe(true);

      visitor.socket.disconnect();
      reconnected = connectSocket(app.baseUrl, '/visitor', visitor.session.token);
      await waitConnect(reconnected);
      const history = await syncHistory(reconnected, started.conversation.id);
      expect(history.messages.map((message) => message.body)).toEqual(['olá', 'oi']);

      const replay = await sendMessage(reconnected, started.conversation.id, firstId, 'olá');
      expect(replay.ok && replay.created).toBe(false);
      const count = await withTenant(app.pool, demoIds.tenantA, (client) =>
        client.query<{ count: string }>(
          'SELECT count(*)::text AS count FROM messages WHERE conversation_id = $1',
          [started.conversation.id],
        ),
      );
      expect(count.rows[0]?.count).toBe('2');
      await emitAck(agent, 'conversation.release', { conversationId: started.conversation.id });
    } finally {
      visitor.socket.disconnect();
      reconnected?.disconnect();
      agent.disconnect();
    }
  });
});
