import { randomUUID } from 'node:crypto';
import { conversationAckSchema } from '@viavoip/protocol';
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

describe('mensagens idempotentes', () => {
  it('grava uma vez e confirma o mesmo messageId no reenvio', async () => {
    const visitor = await openVisitor(app.baseUrl, demoSites.a);
    const started = await startConversation(visitor.socket, demoIds.queueSupportA);
    const ana = await login(app.baseUrl, demoAccounts.ana, demoPassword);
    const agent = connectSocket(app.baseUrl, '/agent', ana.token);
    try {
      await waitConnect(agent);
      const claim = conversationAckSchema.parse(
        await emitAck(agent, 'conversation.claim', { conversationId: started.conversation.id }),
      );
      if (!claim.ok) throw new Error(claim.error.message);

      let broadcasts = 0;
      agent.on('message.new', () => {
        broadcasts += 1;
      });
      const requestId = randomUUID();
      const first = await sendMessage(visitor.socket, started.conversation.id, requestId, 'primeira');
      const second = await sendMessage(visitor.socket, started.conversation.id, requestId, 'primeira');
      expect(first.ok && second.ok).toBe(true);
      if (first.ok && second.ok) {
        expect(second.created).toBe(false);
        expect(second.messageId).toBe(first.messageId);
      }
      await new Promise((resolve) => setTimeout(resolve, 150));
      expect(broadcasts).toBe(1);

      const count = await withTenant(app.pool, demoIds.tenantA, (client) =>
        client.query<{ count: string }>(
          'SELECT count(*)::text AS count FROM messages WHERE conversation_id = $1 AND request_id = $2',
          [started.conversation.id, requestId],
        ),
      );
      expect(count.rows[0]?.count).toBe('1');
      await emitAck(agent, 'conversation.release', { conversationId: started.conversation.id });
    } finally {
      visitor.socket.disconnect();
      agent.disconnect();
    }
  });
});
