import { ChatSession } from './ChatSession';
import { MockTransport } from '../transport/MockTransport';

const instant = {
  typingMs: 0,
  sentMs: 0,
  deliveredMs: 0,
  readMs: 0,
  replyMs: 0,
};

describe('ChatSession', () => {
  it('expõe o menu da última mensagem do bot', async () => {
    const session = new ChatSession(new MockTransport({ delays: instant }));
    await session.start('João');
    expect(session.getState().menu).toHaveLength(5);
    expect(session.getState().messages[0]?.direction).toBe('bot');
  });

  it('atualiza o status da mensagem enviada', async () => {
    const session = new ChatSession(new MockTransport({ delays: instant }));
    await session.start('João');
    await session.send('oi');
    const client = session.getState().messages.find((message) => message.direction === 'client');
    expect(client?.status).toBe('read');
  });
});
