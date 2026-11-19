import { asClientId, asMessageId } from '@viavoip/internal-domain';
import { createFakeObjectUrls } from '../../test/fakeObjectUrls';
import { SessionAbortedError, UploadCanceledError, UploadFailedError } from '../abort';
import type { ChatEvent, ChatTransport, ConnectRequest, UploadProgress } from '../ChatTransport';
import { ForbiddenError } from '../errors';
import { MockBackend } from './MockBackend';
import { MockTransport } from './MockTransport';
import {
  BV_TENANT_ID,
  BV_USERS,
  DEFAULT_SESSION,
  ICS_USERS,
  LIVE_CONVERSATION_ID,
  OTHER_CONVERSATION_ID,
} from './seed';

const ME = DEFAULT_SESSION;
/** Outro usuário da mesma empresa: conectar como ele é "trocar de sessão". */
const OTHER: ConnectRequest = { tenantId: DEFAULT_SESSION.tenantId, userId: ICS_USERS.ana };
const C1 = LIVE_CONVERSATION_ID;
const C2 = OTHER_CONVERSATION_ID;

function collect(transport: MockTransport): ChatEvent[] {
  const events: ChatEvent[] = [];
  transport.subscribe((event) => {
    events.push(event);
  });
  return events;
}

function sendText(transport: ChatTransport, text: string, clientId: string) {
  return transport.send({ conversationId: C1, clientId: asClientId(clientId), payload: { type: 'text', text } });
}

const instant = {
  connectMs: 0,
  sentMs: 0,
  deliveredMs: 0,
  readMs: 0,
};

describe('MockTransport', () => {
  it('conecta e envia connecting → connected sem mensagem', async () => {
    const transport = new MockTransport({ delays: instant });
    const events = collect(transport);

    await transport.connect(ME);

    expect(events.map((event) => event.type)).toEqual(['connection', 'connection']);
    expect(events[0]).toMatchObject({ type: 'connection', status: 'connecting' });
    expect(events[1]).toMatchObject({ type: 'connection', status: 'connected' });
    expect(events.filter((event) => event.type === 'message')).toHaveLength(0);
    expect(transport.getStatus()).toBe('connected');
  });

  it('holdConnect mantém connecting até releaseConnect', async () => {
    const transport = new MockTransport({ delays: instant, holdConnect: true });
    const connecting = transport.connect(ME);
    await vi.waitFor(() => {
      expect(transport.getStatus()).toBe('connecting');
    });
    transport.releaseConnect();
    await connecting;
    expect(transport.getStatus()).toBe('connected');
  });

  it('send de texto progride até read e nenhuma mensagem de outro autor chega', async () => {
    const transport = new MockTransport({ simulateReceipts: true, delays: instant });
    const events = collect(transport);
    await transport.connect(ME);
    events.length = 0;

    await sendText(transport, 'oi', 'local-1');
    await vi.waitFor(() => {
      expect(events.filter((event) => event.type === 'status')).toHaveLength(3);
    });

    const client = events.find((event) => event.type === 'message' && event.message.authorId === ME.userId);
    expect(client?.type).toBe('message');
    if (client?.type !== 'message') {
      throw new Error('esperava mensagem do cliente');
    }
    expect(client.message.clientId).toBe('local-1');
    expect(client.message.id).toMatch(/^msg:ics:/);
    expect(client.message.status).toBe('sending');

    const statuses = events.filter((event) => event.type === 'status').map((event) => event.status);
    expect(statuses).toEqual(['sent', 'delivered', 'read']);
    expect(events.filter((event) => event.type === 'message')).toHaveLength(1);
    expect(
      events.some((event) => event.type === 'message' && event.message.authorId !== ME.userId),
    ).toBe(false);
  });

  it('send em connecting espera o readyGate e entrega uma vez', async () => {
    vi.useFakeTimers();
    const transport = new MockTransport({
      delays: { connectMs: 40, sentMs: 0, deliveredMs: 0, readMs: 0 },
    });
    const events = collect(transport);
    const connecting = transport.connect(ME);
    const sending = sendText(transport, 'oi', 'early');
    await vi.advanceTimersByTimeAsync(20);
    expect(events.filter((event) => event.type === 'message')).toHaveLength(0);

    await vi.runAllTimersAsync();
    await connecting;
    await sending;

    const messages = events.filter((event) => event.type === 'message');
    expect(messages).toHaveLength(1);
    expect(messages[0]?.type === 'message' && messages[0].message.clientId).toBe('early');
    vi.useRealTimers();
  });

  it('após disconnect durante timers, reconecta e envia de novo', async () => {
    vi.useFakeTimers();
    const transport = new MockTransport({ simulateReceipts: true,
      delays: { connectMs: 400, sentMs: 200, deliveredMs: 200, readMs: 200 },
    });
    const events = collect(transport);
    const first = transport.connect(ME);
    await vi.advanceTimersByTimeAsync(100);
    transport.disconnect();
    await expect(first).rejects.toThrow();
    events.length = 0;

    const second = transport.connect(ME);
    await vi.runAllTimersAsync();
    await second;
    expect(events.filter((event) => event.type === 'message')).toHaveLength(0);
    expect(transport.getStatus()).toBe('connected');

    events.length = 0;
    await sendText(transport, '2', 'after-reconnect');
    expect(events.some((event) => event.type === 'message' && event.message.clientId === 'after-reconnect')).toBe(
      true,
    );
    await vi.runAllTimersAsync();
    expect(events.some((event) => event.type === 'status' && event.status === 'read')).toBe(true);
    vi.useRealTimers();
  });

  it('mostra envios rápidos na hora e não responde automaticamente', async () => {
    vi.useFakeTimers();
    const transport = new MockTransport({
      delays: { connectMs: 0, sentMs: 50, deliveredMs: 50, readMs: 50 },
    });
    const events = collect(transport);
    const connecting = transport.connect(ME);
    await vi.runAllTimersAsync();
    await connecting;
    events.length = 0;

    void sendText(transport, '1', 'a');
    void sendText(transport, '2', 'b');
    const clientIds = events
      .filter((event) => event.type === 'message' && event.message.authorId === ME.userId)
      .map((event) => (event.type === 'message' ? event.message.clientId : ''));
    expect(clientIds).toEqual(['a', 'b']);

    await vi.runAllTimersAsync();
    expect(events.filter((event) => event.type === 'message')).toHaveLength(2);
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
    await transport.connect(ME);

    const file = new File([new Uint8Array(100)], 'foto.png', { type: 'image/png' });
    const progress: UploadProgress[] = [];
    const uploading = transport.upload({ target: { kind: 'conversation', conversationId: C1 },
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
    await transport.connect(ME);
    const file = new File([new Uint8Array(100)], 'foto.png', { type: 'image/png' });
    const firstProgress: UploadProgress[] = [];
    const first = expect(
      transport.upload({ target: { kind: 'conversation', conversationId: C1 },
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
    const second = transport.upload({ target: { kind: 'conversation', conversationId: C1 },
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
    await transport.connect(ME);
    const file = new File([new Uint8Array(10)], 'foto.png', { type: 'image/png' });
    await expect(
      transport.upload({ target: { kind: 'conversation', conversationId: C1 },
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
    await transport.connect(ME);
    const controller = new AbortController();
    const progress: UploadProgress[] = [];
    const uploading = transport.upload({ target: { kind: 'conversation', conversationId: C1 },
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
    await transport.connect(ME);
    const uploading = transport.upload({ target: { kind: 'conversation', conversationId: C1 },
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

  it('upload desconectado rejeita e em connecting espera o readyGate', async () => {
    const disconnected = new MockTransport({ delays: instant, objectUrls: createFakeObjectUrls() });
    await expect(
      disconnected.upload({ target: { kind: 'conversation', conversationId: C1 },
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
      delays: { connectMs: 40, sentMs: 0, deliveredMs: 0, readMs: 0, uploadChunkMs: 0 },
      objectUrls: createFakeObjectUrls(),
    });
    const connecting = transport.connect(ME);
    const uploading = transport.upload({ target: { kind: 'conversation', conversationId: C1 },
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

  it('send de imagem ecoa sem resposta automática e progride os ticks', async () => {
    const transport = new MockTransport({ simulateReceipts: true, delays: instant });
    const events = collect(transport);
    await transport.connect(ME);
    events.length = 0;
    await transport.send({
      conversationId: C1,
      clientId: asClientId('img-1'),
      payload: { type: 'image', mimeType: 'image/png', url: 'blob:remote/1', caption: 'rx' },
    });
    await vi.waitFor(() => {
      expect(events.filter((event) => event.type === 'status' && event.status === 'read')).toHaveLength(1);
    });
    const client = events.find((event) => event.type === 'message' && event.message.authorId === ME.userId);
    expect(client?.type).toBe('message');
    if (client?.type !== 'message' || client.message.type !== 'image') {
      throw new Error('esperava imagem');
    }
    expect(client.message.clientId).toBe('img-1');
    expect(client.message.caption).toBe('rx');
    expect(events.filter((event) => event.type === 'message')).toHaveLength(1);
  });

  it('send de documento preserva fileName e sizeBytes', async () => {
    const transport = new MockTransport({ delays: instant });
    const events = collect(transport);
    await transport.connect(ME);
    await transport.send({
      conversationId: C1,
      clientId: asClientId('doc-1'),
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
    await transport.connect(ME);
    await transport.upload({ target: { kind: 'conversation', conversationId: C1 },
      clientId: 'up-1',
      file: new File([new Uint8Array(4)], 'foto.png', { type: 'image/png' }),
      fileName: 'foto.png',
      mimeType: 'image/png',
      signal: new AbortController().signal,
      onProgress: () => {},
    });
    expect(urls.created).toEqual(['blob:fake/1']);
    await transport.connect(OTHER);
    expect(urls.revoked).toEqual(['blob:fake/1']);
  });

  it('reconectar na mesma conversa não revoga URLs de mídia já entregues', async () => {
    const urls = createFakeObjectUrls();
    const transport = new MockTransport({ delays: instant, objectUrls: urls });
    await transport.connect(ME);
    const uploaded = await transport.upload({ target: { kind: 'conversation', conversationId: C1 },
      clientId: 'up-1',
      file: new File([new Uint8Array(4)], 'foto.png', { type: 'image/png' }),
      fileName: 'foto.png',
      mimeType: 'image/png',
      signal: new AbortController().signal,
      onProgress: () => {},
    });
    expect(uploaded.url).toBe('blob:fake/1');
    await transport.connect(ME);
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
    await transport.connect(ME);
    const uploading = transport.upload({ target: { kind: 'conversation', conversationId: C1 },
      clientId: 'up-1',
      file: new File([new Uint8Array(100)], 'foto.png', { type: 'image/png' }),
      fileName: 'foto.png',
      mimeType: 'image/png',
      signal: new AbortController().signal,
      onProgress: () => {},
    });
    await vi.advanceTimersByTimeAsync(20);
    const reconnecting = transport.connect(ME);
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
    await transport.connect(ME);
    const uploading = transport.upload({ target: { kind: 'conversation', conversationId: C1 },
      clientId: 'up-1',
      file: new File([new Uint8Array(100)], 'foto.png', { type: 'image/png' }),
      fileName: 'foto.png',
      mimeType: 'image/png',
      signal: new AbortController().signal,
      onProgress: () => {},
    });
    await vi.advanceTimersByTimeAsync(20);
    const switching = transport.connect(OTHER);
    await expect(uploading).rejects.toBeInstanceOf(SessionAbortedError);
    await vi.runAllTimersAsync();
    await switching;
    vi.useRealTimers();
  });

  it('depois de disconnect, reconectar na mesma conversa volta a connected', async () => {
    const transport = new MockTransport({ delays: instant });
    await transport.connect(ME);
    expect(transport.getStatus()).toBe('connected');
    transport.disconnect();
    expect(transport.getStatus()).toBe('disconnected');
    await expect(transport.connect(ME)).resolves.toMatchObject({ me: { id: ME.userId } });
    expect(transport.getStatus()).toBe('connected');
  });

  it('send durante reconexão da mesma conversa espera a conexão corrente', async () => {
    vi.useFakeTimers();
    const transport = new MockTransport({
      delays: { connectMs: 40, sentMs: 0, deliveredMs: 0, readMs: 0, uploadChunkMs: 0 },
      objectUrls: createFakeObjectUrls(),
    });
    const events = collect(transport);
    const first = transport.connect(ME);
    await vi.runAllTimersAsync();
    await first;
    events.length = 0;
    const uploading = transport.upload({ target: { kind: 'conversation', conversationId: C1 },
      clientId: 'up-short',
      file: new File([new Uint8Array(4)], 'foto.png', { type: 'image/png' }),
      fileName: 'foto.png',
      mimeType: 'image/png',
      signal: new AbortController().signal,
      onProgress: () => {},
    });
    const reconnecting = transport.connect(ME);
    expect(transport.getStatus()).toBe('connecting');
    await expect(uploading).resolves.toMatchObject({ url: expect.stringMatching(/^blob:fake\//) });
    const sending = sendText(transport, '1', 'during-reconnect');
    await vi.advanceTimersByTimeAsync(20);
    expect(events.some((event) => event.type === 'message' && event.message.clientId === 'during-reconnect')).toBe(
      false,
    );
    await vi.runAllTimersAsync();
    await expect(sending).resolves.toBeUndefined();
    await reconnecting;
    expect(transport.getStatus()).toBe('connected');
    expect(events.some((event) => event.type === 'message' && event.message.clientId === 'during-reconnect')).toBe(
      true,
    );
    vi.useRealTimers();
  });
});

const file = () => new File([new Uint8Array(100)], 'foto.png', { type: 'image/png' });

function uploadRequest(conversationId: typeof C1, clientId: string, signal = new AbortController().signal) {
  return {
    target: { kind: 'conversation' as const, conversationId },
    clientId,
    file: file(),
    fileName: 'foto.png',
    mimeType: 'image/png',
    signal,
    onProgress: () => {},
  };
}

describe('MockTransport por conversa', () => {
  it('upload em c1 não é afetado por envio, abertura de direta nem digitação em c2', async () => {
    vi.useFakeTimers();
    const urls = createFakeObjectUrls();
    const transport = new MockTransport({
      delays: { ...instant, uploadChunkMs: 20 },
      uploadChunks: 5,
      objectUrls: urls,
    });
    await transport.connect(ME);
    const uploading = transport.upload(uploadRequest(C1, 'up-c1'));
    await vi.advanceTimersByTimeAsync(20);
    await transport.send({ conversationId: C2, clientId: asClientId('msg-c2'), payload: { type: 'text', text: 'outra' } });
    await transport.openDirect({ with: ICS_USERS.diego });
    transport.setActivity({ conversationId: C2, activity: 'typing' });
    await vi.advanceTimersByTimeAsync(20);
    await transport.markRead({ conversationId: C2, upToMessageId: await lastMessageId(transport) });
    await vi.runAllTimersAsync();
    await expect(uploading).resolves.toEqual({ url: 'blob:fake/1' });
    expect(urls.revoked).toEqual([]);
    vi.useRealTimers();
  });

  it('dois uploads simultâneos em conversas diferentes guardam URLs separadas e disconnect revoga as duas', async () => {
    vi.useFakeTimers();
    const urls = createFakeObjectUrls();
    const transport = new MockTransport({
      delays: { ...instant, uploadChunkMs: 5 },
      uploadChunks: 2,
      objectUrls: urls,
    });
    await transport.connect(ME);
    const first = transport.upload(uploadRequest(C1, 'up-1'));
    const second = transport.upload(uploadRequest(C2, 'up-2'));
    await vi.runAllTimersAsync();
    const [one, two] = await Promise.all([first, second]);
    expect(one.url).not.toBe(two.url);
    expect(urls.revoked).toEqual([]);
    transport.disconnect();
    expect([...urls.revoked].sort()).toEqual([one.url, two.url].sort());
    vi.useRealTimers();
  });

  it('o cancelamento de um upload não afeta o upload de outra conversa', async () => {
    vi.useFakeTimers();
    const transport = new MockTransport({
      delays: { ...instant, uploadChunkMs: 20 },
      objectUrls: createFakeObjectUrls(),
    });
    await transport.connect(ME);
    const controller = new AbortController();
    const canceled = expect(transport.upload(uploadRequest(C1, 'up-1', controller.signal))).rejects.toBeInstanceOf(
      UploadCanceledError,
    );
    const kept = transport.upload(uploadRequest(C2, 'up-2'));
    await vi.advanceTimersByTimeAsync(20);
    controller.abort();
    await canceled;
    await vi.runAllTimersAsync();
    await expect(kept).resolves.toMatchObject({ url: expect.stringMatching(/^blob:fake\//) });
    vi.useRealTimers();
  });

  it('upload que falha em c1 deixa o de c2 concluir (failUpload once vale por clientId)', async () => {
    vi.useFakeTimers();
    const transport = new MockTransport({
      delays: { ...instant, uploadChunkMs: 5 },
      failUpload: 'once',
      objectUrls: createFakeObjectUrls(),
    });
    await transport.connect(ME);
    const failing = expect(transport.upload(uploadRequest(C1, 'up-1'))).rejects.toBeInstanceOf(UploadFailedError);
    const ok = transport.upload(uploadRequest(C2, 'up-2'));
    const okFailing = expect(ok).rejects.toBeInstanceOf(UploadFailedError);
    await vi.runAllTimersAsync();
    await failing;
    await okFailing;
    const retry = transport.upload(uploadRequest(C1, 'up-1'));
    await vi.runAllTimersAsync();
    await expect(retry).resolves.toMatchObject({ url: expect.stringMatching(/^blob:fake\//) });
    vi.useRealTimers();
  });

  it('upload, envio, markRead e abertura em conversa de outro tenant rejeitam com ForbiddenError', async () => {
    const urls = createFakeObjectUrls();
    const transport = new MockTransport({ delays: { ...instant, uploadChunkMs: 0 }, objectUrls: urls });
    const events = collect(transport);
    await transport.connect(ME);
    events.length = 0;
    const foreign = 'dm:bv:bv-otavio:bv-paula' as typeof C1;
    await expect(transport.upload(uploadRequest(foreign, 'up-x'))).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      transport.send({ conversationId: foreign, clientId: asClientId('x'), payload: { type: 'text', text: 'oi' } }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(transport.markRead({ conversationId: foreign, upToMessageId: asMessageId('msg:bv:1') })).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    await expect(transport.openDirect({ with: BV_USERS.paula })).rejects.toBeInstanceOf(ForbiddenError);
    expect(urls.created).toEqual([]);
    expect(events).toEqual([]);
  });

  it('openDirect devolve a mesma conversa nas duas ordens', async () => {
    const backend = new MockBackend();
    const ana = new MockTransport({ delays: instant, backend });
    const diego = new MockTransport({ delays: instant, backend });
    await ana.connect(OTHER);
    await diego.connect({ tenantId: OTHER.tenantId, userId: ICS_USERS.diego });
    const one = await ana.openDirect({ with: ICS_USERS.diego });
    const two = await diego.openDirect({ with: ICS_USERS.ana });
    expect(two).toEqual(one);
  });

  it('connect de usuário inexistente rejeita com ForbiddenError e o status vira error', async () => {
    const transport = new MockTransport({ delays: instant });
    await expect(
      transport.connect({ tenantId: BV_TENANT_ID, userId: ICS_USERS.carla }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(transport.getStatus()).toBe('error');
  });

  it('descarta evento de outro tenant que chegue ao cliente (defesa em profundidade)', async () => {
    const transport = new MockTransport({ delays: instant });
    const events = collect(transport);
    await transport.connect(ME);
    events.length = 0;
    const deliver = (transport as unknown as { receive(event: ChatEvent): void }).receive.bind(transport);
    deliver({ type: 'activity', tenantId: BV_TENANT_ID, conversationId: C1, userId: BV_USERS.paula, activity: 'typing' });
    expect(events).toEqual([]);
    deliver({ type: 'activity', tenantId: ME.tenantId, conversationId: C1, userId: ICS_USERS.bruno, activity: 'typing' });
    expect(events).toHaveLength(1);
  });

  it('failSend rejeita sem tocar o servidor', async () => {
    const backend = new MockBackend();
    const transport = new MockTransport({ delays: instant, backend, failSend: true });
    await transport.connect(ME);
    await expect(sendText(transport, 'oi', 'x')).rejects.toThrow('Falha ao enviar');
    expect(backend.server.getState().get(ME.tenantId)?.messages[C1]).toEqual([]);
  });
});

async function lastMessageId(transport: MockTransport): Promise<ReturnType<typeof asMessageId>> {
  const bootstrap = await transport.connect(ME);
  const list = bootstrap.recent[C2] ?? [];
  const last = list.at(-1);
  if (!last) {
    throw new Error('esperava mensagem em c2');
  }
  return last.id;
}

describe('MockTransport entre dois usuários (backend compartilhado)', () => {
  function pair() {
    const backend = new MockBackend();
    const carla = new MockTransport({ delays: instant, backend, simulateReceipts: false });
    const bruno = new MockTransport({ delays: instant, backend, simulateReceipts: false });
    const carlaEvents = collect(carla);
    const brunoEvents = collect(bruno);
    const brunoSession: ConnectRequest = { tenantId: ME.tenantId, userId: ICS_USERS.bruno };
    return { backend, carla, bruno, carlaEvents, brunoEvents, brunoSession };
  }

  it('com o destinatário conectado: ele recebe "enviada"; o autor vê sending → sent → delivered', async () => {
    const { carla, bruno, carlaEvents, brunoEvents, brunoSession } = pair();
    await carla.connect(ME);
    await bruno.connect(brunoSession);
    carlaEvents.length = 0;
    brunoEvents.length = 0;
    await sendText(carla, 'oi Bruno', 'c-1');
    await vi.waitFor(() => {
      expect(carlaEvents.filter((event) => event.type === 'status')).toHaveLength(2);
    });
    expect(carlaEvents.map((event) => (event.type === 'message' ? event.message.status : event.type === 'status' ? event.status : event.type))).toEqual(['sending', 'sent', 'delivered']);
    const received = brunoEvents.find((event) => event.type === 'message');
    expect(received?.type === 'message' && received.message).toMatchObject({
      text: 'oi Bruno',
      status: 'sent',
      authorId: ME.userId,
    });
    expect(brunoEvents.filter((event) => event.type === 'message')).toHaveLength(1);
  });

  it('markRead do destinatário gera o evento read e o status lida para o autor', async () => {
    const { carla, bruno, carlaEvents, brunoSession } = pair();
    await carla.connect(ME);
    const bootstrap = await bruno.connect(brunoSession);
    await sendText(carla, 'oi', 'c-1');
    await vi.waitFor(() => {
      expect(carlaEvents.some((event) => event.type === 'status' && event.status === 'delivered')).toBe(true);
    });
    const echo = carlaEvents.find((event) => event.type === 'message');
    if (echo?.type !== 'message') {
      throw new Error('esperava o eco da mensagem');
    }
    const messageId = echo.message.id;
    expect(bootstrap.conversations.find((item) => item.id === C1)?.unread).toBe(0);
    carlaEvents.length = 0;
    await bruno.markRead({ conversationId: C1, upToMessageId: messageId });
    expect(carlaEvents.map((event) => event.type).sort()).toEqual(['read', 'status']);
    expect(carlaEvents.find((event) => event.type === 'status')).toMatchObject({ status: 'read', messageId });
    expect(carlaEvents.find((event) => event.type === 'read')).toMatchObject({
      userId: ICS_USERS.bruno,
      upToMessageId: messageId,
    });
  });

  it('destinatário offline: fica "enviada" e vira "entregue" quando ele conecta; o Bootstrap traz a não lida', async () => {
    const { carla, bruno, carlaEvents, brunoSession } = pair();
    await carla.connect(ME);
    await sendText(carla, 'quando puder', 'c-1');
    await vi.waitFor(() => {
      expect(carlaEvents.some((event) => event.type === 'status' && event.status === 'sent')).toBe(true);
    });
    expect(carlaEvents.some((event) => event.type === 'status' && event.status === 'delivered')).toBe(false);
    const bootstrap = await bruno.connect(brunoSession);
    expect(bootstrap.conversations.find((item) => item.id === C1)?.unread).toBe(1);
    expect(bootstrap.recent[C1]?.map((message) => message.status)).toEqual(['delivered']);
    expect(carlaEvents.some((event) => event.type === 'status' && event.status === 'delivered')).toBe(true);
  });

  it('digitação chega ao outro participante e não a quem digita', async () => {
    const { carla, bruno, carlaEvents, brunoEvents, brunoSession } = pair();
    await carla.connect(ME);
    await bruno.connect(brunoSession);
    carlaEvents.length = 0;
    brunoEvents.length = 0;
    bruno.setActivity({ conversationId: C1, activity: 'typing' });
    expect(carlaEvents).toEqual([
      { type: 'activity', tenantId: ME.tenantId, conversationId: C1, userId: ICS_USERS.bruno, activity: 'typing' },
    ]);
    expect(brunoEvents).toEqual([]);
  });

  it('simulateReceipts: true lê pelo destinatário: ticks sent, delivered e read', async () => {
    const transport = new MockTransport({ delays: instant, simulateReceipts: true });
    const events = collect(transport);
    await transport.connect(ME);
    events.length = 0;
    await sendText(transport, 'oi', 'c-1');
    await vi.waitFor(() => {
      expect(events.some((event) => event.type === 'status' && event.status === 'read')).toBe(true);
    });
    expect(events.flatMap((event) => (event.type === 'status' ? [event.status] : []))).toEqual([
      'sent',
      'delivered',
      'read',
    ]);
  });
});
