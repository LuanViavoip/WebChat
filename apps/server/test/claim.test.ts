import { conversationAckSchema } from '@viavoip/protocol';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withTenant } from '../src/db/tenant.js';
import { demoAccounts, demoIds, demoPassword, demoSites } from '../src/demo/ids.js';
import { connectSocket, emitAck, login, openVisitor, startConversation, startTestApp, type TestApp, waitConnect } from './helpers.js';

let app: TestApp;

beforeAll(async () => {
  app = await startTestApp();
});

afterAll(async () => {
  await app.app.close();
});

describe('claim concorrente', () => {
  it('permite que apenas um agente assuma a conversa', async () => {
    const visitor = await openVisitor(app.baseUrl, demoSites.a);
    const started = await startConversation(visitor.socket, demoIds.queueSupportA);
    const ana = await login(app.baseUrl, demoAccounts.ana, demoPassword);
    const bruno = await login(app.baseUrl, demoAccounts.bruno, demoPassword);
    const anaSocket = connectSocket(app.baseUrl, '/agent', ana.token);
    const brunoSocket = connectSocket(app.baseUrl, '/agent', bruno.token);
    await Promise.all([waitConnect(anaSocket), waitConnect(brunoSocket)]);

    const [first, second] = await Promise.all([
      emitAck(anaSocket, 'conversation.claim', { conversationId: started.conversation.id }),
      emitAck(brunoSocket, 'conversation.claim', { conversationId: started.conversation.id }),
    ]);
    const results = [conversationAckSchema.parse(first), conversationAckSchema.parse(second)];
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    const failure = results.find((result) => !result.ok);
    expect(failure && !failure.ok ? failure.error.code : '').toBe('already_claimed');

    const owner = await withTenant(app.pool, demoIds.tenantA, (client) =>
      client.query<{ agent_id: string; status: string }>(
        'SELECT agent_id, status FROM conversations WHERE id = $1',
        [started.conversation.id],
      ),
    );
    expect(owner.rows[0]?.status).toBe('assigned');
    expect([demoIds.agentAna, demoIds.agentBruno]).toContain(owner.rows[0]?.agent_id);
    expect(app.sm.calls.filter((call) => call.method === 'onConversationAssigned')).toHaveLength(1);
    await emitAck(anaSocket, 'conversation.release', { conversationId: started.conversation.id });
    await emitAck(brunoSocket, 'conversation.release', { conversationId: started.conversation.id });

    visitor.socket.disconnect();
    anaSocket.disconnect();
    brunoSocket.disconnect();
  });
});
