import { createFakeObjectUrls } from '../test/fakeObjectUrls';
import { SessionAbortedError, UploadCanceledError, UploadFailedError } from './abort';
import type { ChatEvent, ChatTransport, UploadProgress } from './ChatTransport';
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

  it('emite 5 progressos e resolve a URL no upload', async () => {
    vi.useFakeTimers();
    const urls = createFakeObjectUrls();
    const transport = new MockTransport({
      delays: { ...instant, uploadChunkMs: 5 },
      uploadChunks: 5,
      objectUrls: urls,
    });
    const connecting = transport.connect({ conversationId: 'c1', patientName: 'Ana' });
    await vi.runAllTimersAsync();
    await connecting;

    const file = new File([new Uint8Array(100)], 'foto.png', { type: 'image/png' });
    const progress: UploadProgress[] = [];
    const uploading = transport.upload({
      clientId: 'up-1',
      file,
      fileName: 'foto.png',
      mimeType: 'image/png',
      signal: new AbortController().signal,
      onProgress: (item) => {
        progress.push(item);
      },
    });
    for (let step = 0; step < 5; step += 1) {
      await vi.advanceTimersByTimeAsync(5);
    }
    await expect(uploading).resolves.toEqual({ url: 'blob:fake/1' });
    expect(progress).toEqual([
      { loaded: 20, total: 100 },
      { loaded: 40, total: 100 },
      { loaded: 60, total: 100 },
      { loaded: 80, total: 100 },
      { loaded: 100, total: 100 },
    ]);
    vi.useRealTimers();
  });

  it('failUpload once falha na primeira tentativa e conclui na segunda', async () => {
    vi.useFakeTimers();
    const transport = new MockTransport({
      delays: { ...instant, uploadChunkMs: 5 },
      uploadChunks: 5,
      failUpload: 'once',
      objectUrls: createFakeObjectUrls(),
    });
    const connecting = transport.connect({ conversationId: 'c1', patientName: 'Ana' });
    await vi.runAllTimersAsync();
    await connecting;
    const file = new File([new Uint8Array(100)], 'foto.png', { type: 'image/png' });
    const firstProgress: UploadProgress[] = [];
    const first = expect(
      transport.upload({
        clientId: 'up-1',
        file,
        fileName: 'foto.png',
        mimeType: 'image/png',
        signal: new AbortController().signal,
        onProgress: (item) => {
          firstProgress.push(item);
        },
      }),
    ).rejects.toBeInstanceOf(UploadFailedError);
    await vi.runAllTimersAsync();
    await first;
    expect(firstProgress).toHaveLength(3);

    const secondProgress: UploadProgress[] = [];
    const second = transport.upload({
      clientId: 'up-1',
      file,
      fileName: 'foto.png',
      mimeType: 'image/png',
      signal: new AbortController().signal,
      onProgress: (item) => {
        secondProgress.push(item);
      },
    });
    await vi.runAllTimersAsync();
    await expect(second).resolves.toMatchObject({ url: expect.stringMatching(/^blob:fake\//) });
    expect(secondProgress).toHaveLength(5);
    vi.useRealTimers();
  });

  it('failUpload always sempre falha', async () => {
    const transport = new MockTransport({
      delays: instant,
      failUpload: 'always',
      objectUrls: createFakeObjectUrls(),
    });
    await transport.connect({ conversationId: 'c1', patientName: 'Ana' });
    const file = new File([new Uint8Array(10)], 'foto.png', { type: 'image/png' });
    await expect(
      transport.upload({
        clientId: 'up-1',
        file,
        fileName: 'foto.png',
        mimeType: 'image/png',
        signal: new AbortController().signal,
        onProgress: () => {},
      }),
    ).rejects.toBeInstanceOf(UploadFailedError);
  });

  it('abort do signal cancela e não emite mais progresso', async () => {
    vi.useFakeTimers();
    const transport = new MockTransport({
      delays: { ...instant, uploadChunkMs: 20 },
      objectUrls: createFakeObjectUrls(),
    });
    const connecting = transport.connect({ conversationId: 'c1', patientName: 'Ana' });
    await vi.runAllTimersAsync();
    await connecting;
    const controller = new AbortController();
    const progress: UploadProgress[] = [];
    const uploading = transport.upload({
      clientId: 'up-1',
      file: new File([new Uint8Array(100)], 'foto.png', { type: 'image/png' }),
      fileName: 'foto.png',
      mimeType: 'image/png',
      signal: controller.signal,
      onProgress: (item) => {
        progress.push(item);
      },
    });
    await vi.advanceTimersByTimeAsync(20);
    expect(progress).toHaveLength(1);
    controller.abort();
    await expect(uploading).rejects.toBeInstanceOf(UploadCanceledError);
    await vi.runAllTimersAsync();
    expect(progress).toHaveLength(1);
    vi.useRealTimers();
  });

  it('disconnect durante o upload rejeita SessionAbortedError', async () => {
    vi.useFakeTimers();
    const transport = new MockTransport({
      delays: { ...instant, uploadChunkMs: 20 },
      objectUrls: createFakeObjectUrls(),
    });
    const connecting = transport.connect({ conversationId: 'c1', patientName: 'Ana' });
    await vi.runAllTimersAsync();
    await connecting;
    const uploading = transport.upload({
      clientId: 'up-1',
      file: new File([new Uint8Array(100)], 'foto.png', { type: 'image/png' }),
      fileName: 'foto.png',
      mimeType: 'image/png',
      signal: new AbortController().signal,
      onProgress: () => {},
    });
    transport.disconnect();
    await expect(uploading).rejects.toBeInstanceOf(SessionAbortedError);
    vi.useRealTimers();
  });

  it('upload desconectado rejeita e em connecting espera as boas-vindas', async () => {
    const disconnected = new MockTransport({ delays: instant, objectUrls: createFakeObjectUrls() });
    await expect(
      disconnected.upload({
        clientId: 'up-1',
        file: new File([new Uint8Array(4)], 'foto.png', { type: 'image/png' }),
        fileName: 'foto.png',
        mimeType: 'image/png',
        signal: new AbortController().signal,
        onProgress: () => {},
      }),
    ).rejects.toThrow('Não conectado');

    vi.useFakeTimers();
    const transport = new MockTransport({
      delays: { typingMs: 40, sentMs: 0, deliveredMs: 0, readMs: 0, replyMs: 40, uploadChunkMs: 0 },
      objectUrls: createFakeObjectUrls(),
    });
    const connecting = transport.connect({ conversationId: 'c1', patientName: 'Ana' });
    const uploading = transport.upload({
      clientId: 'up-1',
      file: new File([new Uint8Array(4)], 'foto.png', { type: 'image/png' }),
      fileName: 'foto.png',
      mimeType: 'image/png',
      signal: new AbortController().signal,
      onProgress: () => {},
    });
    await vi.advanceTimersByTimeAsync(20);
    await vi.runAllTimersAsync();
    await connecting;
    await expect(uploading).resolves.toMatchObject({ url: expect.stringMatching(/^blob:fake\//) });
    vi.useRealTimers();
  });

  it('send de imagem ecoa sem resposta do bot e progride os ticks', async () => {
    const transport = new MockTransport({ delays: instant });
    const events = collect(transport);
    await transport.connect({ conversationId: 'c1', patientName: 'Ana' });
    events.length = 0;
    await transport.send({
      clientId: 'img-1',
      payload: { type: 'image', mimeType: 'image/png', url: 'blob:remote/1', caption: 'rx' },
    });
    await vi.waitFor(() => {
      expect(events.filter((event) => event.type === 'status' && event.status === 'read')).toHaveLength(1);
    });
    const client = events.find((event) => event.type === 'message' && event.message.direction === 'client');
    expect(client?.type).toBe('message');
    if (client?.type !== 'message' || client.message.type !== 'image') {
      throw new Error('esperava imagem');
    }
    expect(client.message.id).toBe('img-1');
    expect(client.message.caption).toBe('rx');
    expect(events.some((event) => event.type === 'message' && event.message.direction === 'bot')).toBe(false);
  });

  it('send de documento preserva fileName e sizeBytes', async () => {
    const transport = new MockTransport({ delays: instant });
    const events = collect(transport);
    await transport.connect({ conversationId: 'c1', patientName: 'Ana' });
    await transport.send({
      clientId: 'doc-1',
      payload: {
        type: 'document',
        fileName: 'guia.pdf',
        mimeType: 'application/pdf',
        url: 'blob:remote/doc',
        sizeBytes: 2048,
      },
    });
    const client = events.find((event) => event.type === 'message' && event.message.type === 'document');
    expect(client?.type).toBe('message');
    if (client?.type !== 'message' || client.message.type !== 'document') {
      throw new Error('esperava documento');
    }
    expect(client.message.fileName).toBe('guia.pdf');
    expect(client.message.sizeBytes).toBe(2048);
  });

  it('resetSession no novo connect revoga as URLs do mock', async () => {
    const urls = createFakeObjectUrls();
    const transport = new MockTransport({ delays: instant, objectUrls: urls });
    await transport.connect({ conversationId: 'c1', patientName: 'Ana' });
    await transport.upload({
      clientId: 'up-1',
      file: new File([new Uint8Array(4)], 'foto.png', { type: 'image/png' }),
      fileName: 'foto.png',
      mimeType: 'image/png',
      signal: new AbortController().signal,
      onProgress: () => {},
    });
    expect(urls.created).toEqual(['blob:fake/1']);
    await transport.connect({ conversationId: 'c2', patientName: 'Ana' });
    expect(urls.revoked).toEqual(['blob:fake/1']);
  });

  it('reconectar na mesma conversa não revoga URLs de mídia já entregues', async () => {
    const urls = createFakeObjectUrls();
    const transport = new MockTransport({ delays: instant, objectUrls: urls });
    await transport.connect({ conversationId: 'c1', patientName: 'Ana' });
    const uploaded = await transport.upload({
      clientId: 'up-1',
      file: new File([new Uint8Array(4)], 'foto.png', { type: 'image/png' }),
      fileName: 'foto.png',
      mimeType: 'image/png',
      signal: new AbortController().signal,
      onProgress: () => {},
    });
    expect(uploaded.url).toBe('blob:fake/1');
    await transport.connect({ conversationId: 'c1', patientName: 'Ana' });
    expect(urls.revoked).not.toContain(uploaded.url);
    transport.disconnect();
    expect(urls.revoked).toContain(uploaded.url);
  });

  it('connect na mesma conversa durante o upload deixa o upload concluir', async () => {
    vi.useFakeTimers();
    const transport = new MockTransport({
      delays: { ...instant, uploadChunkMs: 20 },
      uploadChunks: 5,
      objectUrls: createFakeObjectUrls(),
    });
    const connecting = transport.connect({ conversationId: 'c1', patientName: 'Ana' });
    await vi.runAllTimersAsync();
    await connecting;
    const uploading = transport.upload({
      clientId: 'up-1',
      file: new File([new Uint8Array(100)], 'foto.png', { type: 'image/png' }),
      fileName: 'foto.png',
      mimeType: 'image/png',
      signal: new AbortController().signal,
      onProgress: () => {},
    });
    await vi.advanceTimersByTimeAsync(20);
    const reconnecting = transport.connect({ conversationId: 'c1', patientName: 'Ana' });
    await vi.runAllTimersAsync();
    await expect(uploading).resolves.toMatchObject({ url: expect.stringMatching(/^blob:fake\//) });
    await reconnecting;
    vi.useRealTimers();
  });

  it('connect em outra conversa durante o upload aborta o upload', async () => {
    vi.useFakeTimers();
    const transport = new MockTransport({
      delays: { ...instant, uploadChunkMs: 20 },
      uploadChunks: 5,
      objectUrls: createFakeObjectUrls(),
    });
    const connecting = transport.connect({ conversationId: 'c1', patientName: 'Ana' });
    await vi.runAllTimersAsync();
    await connecting;
    const uploading = transport.upload({
      clientId: 'up-1',
      file: new File([new Uint8Array(100)], 'foto.png', { type: 'image/png' }),
      fileName: 'foto.png',
      mimeType: 'image/png',
      signal: new AbortController().signal,
      onProgress: () => {},
    });
    await vi.advanceTimersByTimeAsync(20);
    const switching = transport.connect({ conversationId: 'c2', patientName: 'Ana' });
    await expect(uploading).rejects.toBeInstanceOf(SessionAbortedError);
    await vi.runAllTimersAsync();
    await switching;
    vi.useRealTimers();
  });

  it('depois de disconnect, reconectar na mesma conversa volta a connected', async () => {
    vi.useFakeTimers();
    const transport = new MockTransport({
      delays: { typingMs: 20, sentMs: 0, deliveredMs: 0, readMs: 0, replyMs: 20 },
    });
    const first = transport.connect({ conversationId: 'c1', patientName: 'Ana' });
    await vi.runAllTimersAsync();
    await first;
    expect(transport.getStatus()).toBe('connected');
    transport.disconnect();
    expect(transport.getStatus()).toBe('disconnected');
    const second = transport.connect({ conversationId: 'c1', patientName: 'Ana' });
    await vi.runAllTimersAsync();
    await expect(second).resolves.toBeUndefined();
    expect(transport.getStatus()).toBe('connected');
    vi.useRealTimers();
  });

  it('send durante reconexão da mesma conversa espera a conexão corrente', async () => {
    vi.useFakeTimers();
    const transport = new MockTransport({
      delays: { typingMs: 40, sentMs: 0, deliveredMs: 0, readMs: 0, replyMs: 40, uploadChunkMs: 0 },
      objectUrls: createFakeObjectUrls(),
    });
    const events = collect(transport);
    const first = transport.connect({ conversationId: 'c1', patientName: 'Ana' });
    await vi.runAllTimersAsync();
    await first;
    events.length = 0;
    const uploading = transport.upload({
      clientId: 'up-short',
      file: new File([new Uint8Array(4)], 'foto.png', { type: 'image/png' }),
      fileName: 'foto.png',
      mimeType: 'image/png',
      signal: new AbortController().signal,
      onProgress: () => {},
    });
    const reconnecting = transport.connect({ conversationId: 'c1', patientName: 'Ana' });
    expect(transport.getStatus()).toBe('connecting');
    await expect(uploading).resolves.toMatchObject({ url: expect.stringMatching(/^blob:fake\//) });
    const sending = sendText(transport, '1', 'during-reconnect');
    await vi.advanceTimersByTimeAsync(20);
    expect(events.some((event) => event.type === 'message' && event.message.id === 'during-reconnect')).toBe(
      false,
    );
    await vi.runAllTimersAsync();
    await expect(sending).resolves.toBeUndefined();
    await reconnecting;
    expect(transport.getStatus()).toBe('connected');
    expect(events.some((event) => event.type === 'message' && event.message.id === 'during-reconnect')).toBe(
      true,
    );
    vi.useRealTimers();
  });

  it('reconectar na mesma conversa não emite a resposta antiga do bot antes das boas-vindas', async () => {
    vi.useFakeTimers();
    const transport = new MockTransport({
      delays: { typingMs: 40, sentMs: 0, deliveredMs: 0, readMs: 0, replyMs: 40 },
    });
    const events = collect(transport);
    const first = transport.connect({ conversationId: 'c1', patientName: 'Ana' });
    await vi.runAllTimersAsync();
    await first;
    events.length = 0;
    await sendText(transport, '1', 'choice-1');
    await vi.advanceTimersByTimeAsync(20);
    const reconnecting = transport.connect({ conversationId: 'c1', patientName: 'Ana' });
    await vi.runAllTimersAsync();
    await reconnecting;
    const texts = events
      .filter((event) => event.type === 'message' && event.message.type === 'text')
      .map((event) => (event.type === 'message' && event.message.type === 'text' ? event.message.text : ''));
    const welcomeIndex = texts.findIndex((text) => text.includes('Como posso ajudar'));
    const oldReplyIndex = texts.findIndex((text) => text.includes('Você escolheu Primeira vez'));
    expect(welcomeIndex).toBeGreaterThanOrEqual(0);
    expect(oldReplyIndex).toBe(-1);
    vi.useRealTimers();
  });
});

