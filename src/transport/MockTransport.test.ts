import type { ChatEvent } from './ChatTransport';
import { MockTransport } from './MockTransport';

function collect(transport: MockTransport): ChatEvent[] {
  const events: ChatEvent[] = [];
  transport.subscribe((event) => {
    events.push(event);
  });
  return events;
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
    expect(types).toEqual(['connection', 'connection', 'typing', 'typing', 'message']);
    expect(events[2]).toMatchObject({ type: 'typing', isTyping: true });
    expect(events[3]).toMatchObject({ type: 'typing', isTyping: false });
  });

  it('progredir status da mensagem do cliente: enviando → enviado → entregue → lido', async () => {
    const transport = new MockTransport({ delays: instant });
    const events = collect(transport);
    await transport.connect({ conversationId: 'c1', patientName: 'Ana' });
    events.length = 0;

    await transport.send('1');

    const client = events.find((event) => event.type === 'message' && event.message.direction === 'client');
    expect(client?.type).toBe('message');
    if (client?.type !== 'message') {
      throw new Error('esperava mensagem do cliente');
    }
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

    const sending = transport.send('4');
    await vi.runAllTimersAsync();
    await sending;

    const bot = events.find((event) => event.type === 'message' && event.message.direction === 'bot');
    expect(bot?.type).toBe('message');
    if (bot?.type !== 'message' || bot.message.type !== 'text') {
      throw new Error('esperava resposta do bot');
    }
    expect(bot.message.text).toContain('Agendamentos');
    vi.useRealTimers();
  });
});
