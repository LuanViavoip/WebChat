import type { ChatEvent, ChatTransport } from './ChatTransport';
import { MockTransport } from './MockTransport';

function collect(transport: MockTransport): ChatEvent[] {
  const events: ChatEvent[] = [];
  transport.subscribe((event) => {
    events.push(event);
  });
  return events;
}

function sendText(transport: ChatTransport, text: string, clientId: string) {
  return transport.send({ clientId, payload: { type: 'text', text } });
}

const instant = {
  typingMs: 0,
  sentMs: 0,
  deliveredMs: 0,
  readMs: 0,
  replyMs: 0,
};

describe('MockTransport', () => {
  it('conecta e envia boas-vindas com nome e menu numerado', async () => {
    const transport = new MockTransport({ delays: instant });
    const events = collect(transport);

    await transport.connect({ conversationId: 'c1', patientName: 'Ana Souza' });

    const messages = events.filter((event) => event.type === 'message');
    expect(messages).toHaveLength(1);
    const welcome = messages[0];
    expect(welcome?.type).toBe('message');
    if (welcome?.type !== 'message' || welcome.message.type !== 'text') {
      throw new Error('esperava mensagem de texto');
    }
    expect(welcome.message.direction).toBe('bot');
    expect(welcome.message.text).toContain('Ana Souza');
    expect(welcome.message.text).toContain('Como posso ajudar? Por favor, digite o número da opção:');
    expect(welcome.message.text).toContain('1 Primeira vez / Orientação');
    expect(welcome.message.text).toContain('0 Encerrar o Atendimento');
    expect(welcome.message.menu?.map((option) => option.key)).toEqual(['1', '2', '3', '4', '0']);
  });

  it('emite indicador de digitação antes da mensagem do bot', async () => {
    const transport = new MockTransport({ delays: instant });
    const events = collect(transport);
    await transport.connect({ conversationId: 'c1', patientName: 'Ana' });
    const types = events.map((event) => event.type);
    expect(types).toEqual(['connection', 'typing', 'typing', 'message', 'connection']);
    expect(events[1]).toMatchObject({ type: 'typing', isTyping: true });
    expect(events[2]).toMatchObject({ type: 'typing', isTyping: false });
    expect(events[4]).toMatchObject({ type: 'connection', status: 'connected' });
  });

  it('progredir status da mensagem do cliente: enviando → enviado → entregue → lido', async () => {
    const transport = new MockTransport({ delays: instant });
    const events = collect(transport);
    await transport.connect({ conversationId: 'c1', patientName: 'Ana' });
    events.length = 0;

    await sendText(transport, '1', 'local-1');
    await vi.waitFor(() => {
      expect(events.filter((event) => event.type === 'status')).toHaveLength(3);
    });

    const client = events.find((event) => event.type === 'message' && event.message.direction === 'client');
    expect(client?.type).toBe('message');
    if (client?.type !== 'message') {
      throw new Error('esperava mensagem do cliente');
    }
    expect(client.message.id).toBe('local-1');
    expect(client.message.status).toBe('sending');

    const statuses = events
      .filter((event) => event.type === 'status')
      .map((event) => event.status);
    expect(statuses).toEqual(['sent', 'delivered', 'read']);
  });

  it('responde a opção do menu com atraso configurável', async () => {
    vi.useFakeTimers();
    const transport = new MockTransport({
      delays: { typingMs: 5, sentMs: 5, deliveredMs: 5, readMs: 5, replyMs: 5 },
    });
    const events = collect(transport);
    const connecting = transport.connect({ conversationId: 'c1', patientName: 'Ana' });
    await vi.runAllTimersAsync();
    await connecting;
    events.length = 0;

    const sending = sendText(transport, '4', 'local-4');
    await sending;
    await vi.runAllTimersAsync();

    const bot = events.find((event) => event.type === 'message' && event.message.direction === 'bot');
    expect(bot?.type).toBe('message');
    if (bot?.type !== 'message' || bot.message.type !== 'text') {
      throw new Error('esperava resposta do bot');
    }
    expect(bot.message.text).toContain('Agendamentos');
    vi.useRealTimers();
  });

  it('após disconnect durante timers, reconecta e envia de novo', async () => {
    vi.useFakeTimers();
    const transport = new MockTransport({
      delays: { typingMs: 400, sentMs: 200, deliveredMs: 200, readMs: 200, replyMs: 400 },
    });
    const events = collect(transport);
    const first = transport.connect({ conversationId: 'c1', patientName: 'Ana' });
    await vi.advanceTimersByTimeAsync(100);
    transport.disconnect();
    await expect(first).rejects.toThrow();
    events.length = 0;

    const second = transport.connect({ conversationId: 'c2', patientName: 'Ana' });
    await vi.runAllTimersAsync();
    await second;
    expect(events.some((event) => event.type === 'message')).toBe(true);

    events.length = 0;
    await sendText(transport, '2', 'after-reconnect');
    expect(events.some((event) => event.type === 'message' && event.message.id === 'after-reconnect')).toBe(
      true,
    );
    await vi.runAllTimersAsync();
    expect(events.some((event) => event.type === 'status' && event.status === 'read')).toBe(true);
    vi.useRealTimers();
  });

  it('mostra envios rápidos na hora e serializa só o bot', async () => {
    vi.useFakeTimers();
    const transport = new MockTransport({
      delays: { typingMs: 50, sentMs: 50, deliveredMs: 50, readMs: 50, replyMs: 50 },
    });
    const events = collect(transport);
    const connecting = transport.connect({ conversationId: 'c1', patientName: 'Ana' });
    await vi.runAllTimersAsync();
    await connecting;
    events.length = 0;

    void sendText(transport, '1', 'a');
    void sendText(transport, '2', 'b');
    const clientIds = events
      .filter((event) => event.type === 'message' && event.message.direction === 'client')
      .map((event) => (event.type === 'message' ? event.message.id : ''));
    expect(clientIds).toEqual(['a', 'b']);

    await vi.runAllTimersAsync();
    const bots = events.filter((event) => event.type === 'message' && event.message.direction === 'bot');
    expect(bots).toHaveLength(2);
    vi.useRealTimers();
  });

  it('enfileira envio do usuário até as boas-vindas terminarem', async () => {
    vi.useFakeTimers();
    const transport = new MockTransport({
      delays: { typingMs: 40, sentMs: 10, deliveredMs: 10, readMs: 10, replyMs: 40 },
    });
    const events = collect(transport);
    const connecting = transport.connect({ conversationId: 'c1', patientName: 'Ana' });
    const sending = sendText(transport, '1', 'early');
    await vi.advanceTimersByTimeAsync(20);
    const earlyMessages = events.filter((event) => event.type === 'message');
    expect(earlyMessages).toHaveLength(0);

    await vi.runAllTimersAsync();
    await connecting;
    await sending;

    const texts = events
      .filter((event) => event.type === 'message' && event.message.type === 'text')
      .map((event) => (event.type === 'message' && event.message.type === 'text' ? event.message.text : ''));
    expect(texts[0]).toContain('Como posso ajudar');
    expect(texts[1]).toBe('1');
    expect(texts[2]).toContain('Primeira vez');
    vi.useRealTimers();
  });
});
