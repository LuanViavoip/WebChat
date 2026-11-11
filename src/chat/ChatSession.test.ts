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
    await session.send({ type: 'text', text: 'oi' });
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

  it('associa clientId e id do servidor e mescla pendências pelo maior rank', () => {
    const transport = new ScriptedTransport();
    const session = new ChatSession(transport);
    void session.start('João', 'c1');
    transport.emit({ type: 'status', messageId: 'srv-1', status: 'read' });
    transport.emit({ type: 'status', messageId: 'cid-1', clientId: 'cid-1', status: 'sent' });
    transport.emit({
      type: 'message',
      message: textMessage({
        id: 'srv-1',
        clientId: 'cid-1',
        direction: 'client',
        text: 'oi',
        status: 'sending',
      }),
    });
    expect(session.getState().messages).toHaveLength(1);
    expect(session.getState().messages[0]?.id).toBe('srv-1');
    expect(session.getState().messages[0]?.status).toBe('read');

    transport.emit({ type: 'status', messageId: 'srv-1', clientId: 'cid-1', status: 'delivered' });
    expect(session.getState().messages[0]?.status).toBe('read');
  });

  it('encerra o atendimento e limpa o menu', async () => {
    const session = new ChatSession(new MockTransport({ delays: instant }));
    await session.start('João');
    await session.send({ type: 'text', text: '0' });
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
    await session.reconnect();
    expect(session.getState().connection).toBe('connected');
    expect(session.getState().error).toBeNull();

    transport.failSend = true;
    await session.send({ type: 'text', text: 'texto preservado' });
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
    expect(session.getState().messages.find((message) => message.direction === 'client')?.status).toBe(
      'sending',
    );
    expect(transport.sent).toHaveLength(2);
    expect(transport.sent[1]?.clientId).toBe('cid-1');
  });

  it('reconectar preserva histórico e mensagem em erro', async () => {
    const transport = new ScriptedTransport();
    const session = new ChatSession(transport, { createId: () => 'keep-1' });
    await session.start('João', 'c1');
    transport.failSend = true;
    await session.send({ type: 'text', text: 'não apague' });
    expect(session.getState().messages.some((message) => message.status === 'error')).toBe(true);

    await session.reconnect();
    const kept = session.getState().messages.find((message) => message.direction === 'client');
    expect(kept?.type).toBe('text');
    if (kept?.type !== 'text') {
      throw new Error('esperava texto');
    }
    expect(kept.text).toBe('não apague');
    expect(kept.status).toBe('error');
    expect(session.getState().error).toBeNull();
  });

  it('iniciar novo atendimento limpa as mensagens', async () => {
    const session = new ChatSession(new MockTransport({ delays: instant }));
    await session.start('João');
    await session.send({ type: 'text', text: '1' });
    await session.start('João');
    expect(session.getState().messages.every((message) => message.direction !== 'client')).toBe(true);
  });

  it('ignora rejeição tardia de send após restart e após unmount', async () => {
    const transport = new ScriptedTransport();
    const session = new ChatSession(transport, { createId: () => 'old-1' });
    await session.start('João', 'c1');
    transport.holdSend = true;
    const first = session.send({ type: 'text', text: 'antiga' });
    await session.start('João', 'c2');
    transport.rejectHeld();
    await first;
    expect(session.getState().error).toBeNull();
    expect(session.getState().messages.find((message) => message.direction === 'client')).toBeUndefined();

    transport.holdSend = true;
    const second = session.send({ type: 'text', text: 'depois' });
    session.stop();
    transport.rejectHeld();
    await second;
    const leftover = session.getState().messages.find((message) => message.direction === 'client');
    expect(leftover?.status).toBe('sending');
    expect(session.getState().error).toBeNull();
  });

  it('envia payload de mídia pelo transporte e marca erro sem UI', async () => {
    const transport = new ScriptedTransport();
    transport.failSend = true;
    const session = new ChatSession(transport, { createId: () => 'img-1' });
    await session.start('João', 'c1');
    await session.send({ type: 'image', mimeType: 'image/jpeg', url: 'blob:preview', caption: 'rx' });
    expect(transport.sent[0]?.payload).toEqual({
      type: 'image',
      mimeType: 'image/jpeg',
      url: 'blob:preview',
      caption: 'rx',
    });
    const image = session.getState().messages.find((message) => message.type === 'image');
    expect(image?.status).toBe('error');
    expect(image?.type).toBe('image');
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
