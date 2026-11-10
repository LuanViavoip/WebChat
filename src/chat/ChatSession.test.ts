import { ScriptedTransport } from '../test/scriptedTransport';
import type { ChatMessage, TextMessage } from '../domain/message';
import { ChatSession } from './ChatSession';
import { MockTransport } from '../transport/MockTransport';

const instant = {
  typingMs: 0,
  sentMs: 0,
  deliveredMs: 0,
  readMs: 0,
  replyMs: 0,
};

function textMessage(partial: Partial<TextMessage> & Pick<TextMessage, 'id' | 'text'>): TextMessage {
  return {
    conversationId: 'c1',
    direction: 'bot',
    author: { id: 'bot', name: 'Bot' },
    timestamp: '2026-11-10T12:00:00.000Z',
    status: 'delivered',
    type: 'text',
    ...partial,
  };
}

describe('ChatSession', () => {
  it('expõe o menu da última mensagem do bot', async () => {
    const session = new ChatSession(new MockTransport({ delays: instant }));
    await session.start('João');
    expect(session.getState().menu).toHaveLength(5);
    expect(session.getState().messages[0]?.direction).toBe('bot');
  });

  it('atualiza o status da mensagem enviada', async () => {
    const session = new ChatSession(new MockTransport({ delays: instant }), { createId: () => 'local-1' });
    await session.start('João');
    await session.send('oi');
    await vi.waitFor(() => {
      expect(session.getState().messages.find((message) => message.direction === 'client')?.status).toBe('read');
    });
  });

  it('deduplica replay e não regride status, salvo erro', () => {
    const transport = new ScriptedTransport();
    const session = new ChatSession(transport);
    void session.start('João', 'c1');
    const first: ChatMessage = textMessage({
      id: 'm1',
      clientId: 'c1',
      direction: 'client',
      text: 'oi',
      status: 'sent',
    });
    transport.emit({ type: 'message', message: first });
    transport.emit({ type: 'message', message: { ...first, status: 'sending' } });
    transport.emit({ type: 'status', messageId: 'm1', status: 'delivered' });
    transport.emit({ type: 'status', messageId: 'm1', status: 'sent' });
    expect(session.getState().messages).toHaveLength(1);
    expect(session.getState().messages[0]?.status).toBe('delivered');
    transport.emit({ type: 'status', messageId: 'm1', status: 'error' });
    expect(session.getState().messages[0]?.status).toBe('error');
  });

  it('guarda status que chega antes da mensagem', () => {
    const transport = new ScriptedTransport();
    const session = new ChatSession(transport);
    void session.start('João', 'c1');
    transport.emit({ type: 'status', messageId: 'late', clientId: 'late', status: 'delivered' });
    expect(session.getState().messages).toHaveLength(0);
    transport.emit({
      type: 'message',
      message: textMessage({ id: 'late', clientId: 'late', direction: 'client', text: 'oi', status: 'sending' }),
    });
    expect(session.getState().messages).toHaveLength(1);
    expect(session.getState().messages[0]?.status).toBe('delivered');
  });

  it('encerra o atendimento e limpa o menu', async () => {
    const session = new ChatSession(new MockTransport({ delays: instant }));
    await session.start('João');
    await session.send('0');
    await vi.waitFor(() => {
      expect(session.getState().ended).toBe(true);
    });
    expect(session.getState().menu).toEqual([]);
  });

  it('marca erro de connect e de send sem perder o texto', async () => {
    const transport = new ScriptedTransport();
    transport.failConnect = true;
    const session = new ChatSession(transport, { createId: () => 'cid-1' });
    await session.start('João', 'c1');
    expect(session.getState().connection).toBe('error');
    expect(session.getState().error).toMatch(/conectar/i);

    transport.failConnect = false;
    await session.start('João', 'c1');
    expect(session.getState().connection).toBe('connected');
    expect(session.getState().error).toBeNull();

    transport.failSend = true;
    await session.send('texto preservado');
    const client = session.getState().messages.find((message) => message.direction === 'client');
    expect(client?.type).toBe('text');
    if (client?.type !== 'text') {
      throw new Error('esperava texto');
    }
    expect(client.text).toBe('texto preservado');
    expect(client.status).toBe('error');
    expect(session.getState().error).toMatch(/enviar/i);

    transport.failSend = false;
    await session.retry(client.id);
    expect(session.getState().messages[0]?.status).toBe('sending');
    expect(transport.sent).toHaveLength(2);
    expect(transport.sent[1]?.clientId).toBe('cid-1');
  });

  it('ignora eventos da sessão anterior após stop', async () => {
    const transport = new ScriptedTransport();
    const session = new ChatSession(transport);
    await session.start('João', 'old');
    session.stop();
    transport.emit({
      type: 'message',
      message: textMessage({ id: 'stale', text: 'não deveria aparecer' }),
    });
    expect(session.getState().messages).toHaveLength(0);
  });
});
