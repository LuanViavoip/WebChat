import { validateFiles } from '../domain/attachment';
import type { ChatMessage, TextMessage } from '../domain/message';
import { createFakeObjectUrls } from '../test/fakeObjectUrls';
import { ScriptedTransport } from '../test/scriptedTransport';
import { SessionAbortedError } from '../transport/abort';
import { MockTransport } from '../transport/MockTransport';
import { ChatSession } from './ChatSession';

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

  it('sendAttachment sobe, troca a URL, envia e chega a lida', async () => {
    const urls = createFakeObjectUrls();
    const session = new ChatSession(
      new MockTransport({ delays: { ...instant, uploadChunkMs: 0 }, objectUrls: urls }),
      { createId: () => 'img-1', objectUrls: urls },
    );
    await session.start('João');
    const createdBefore = urls.created.length;
    await session.sendAttachment(mustAttach('rx.png', 'image/png', 40), 'exame');
    const image = session.getState().messages.find((message) => message.type === 'image');
    expect(image?.status).toBe('read');
    expect(image?.type).toBe('image');
    if (image?.type !== 'image') {
      throw new Error('esperava imagem');
    }
    expect(image.caption).toBe('exame');
    expect(image.url).toMatch(/^blob:fake\//);
    expect(session.getState().uploads).toEqual({});
    expect(urls.revoked).toContain(urls.created[createdBefore]);
  });

  it('insere otimista com preview e progresso só quando o percentual inteiro muda', async () => {
    const urls = createFakeObjectUrls();
    const transport = new ScriptedTransport();
    transport.holdUpload = true;
    const session = new ChatSession(transport, { createId: () => 'img-1', objectUrls: urls });
    await session.start('João', 'c1');
    const sending = session.sendAttachment(mustAttach('rx.png', 'image/png', 100));
    const optimistic = session.getState().messages.find((message) => message.type === 'image');
    expect(optimistic?.status).toBe('sending');
    expect(optimistic?.type).toBe('image');
    if (optimistic?.type !== 'image') {
      throw new Error('esperava imagem');
    }
    expect(optimistic.url).toBe('blob:fake/1');
    expect(session.getState().uploads['img-1']).toMatchObject({
      phase: 'uploading',
      loaded: 0,
      total: 100,
    });
    let emits = 0;
    session.subscribe(() => {
      emits += 1;
    });
    transport.progressUpload(0, 20);
    transport.progressUpload(0, 20);
    expect(session.getState().uploads['img-1']).toMatchObject({ loaded: 20 });
    transport.resolveUpload(0, 'blob:remote/1');
    await sending;
    expect(emits).toBeGreaterThan(0);
  });

  it('falha de upload marca erro na bolha sem state.error', async () => {
    const transport = new ScriptedTransport();
    transport.failUpload = true;
    const session = new ChatSession(transport, {
      createId: () => 'img-1',
      objectUrls: createFakeObjectUrls(),
    });
    await session.start('João', 'c1');
    await session.sendAttachment(mustAttach('exame.png', 'image/png', 12));
    expect(session.getState().messages.find((message) => message.type === 'image')?.status).toBe('error');
    expect(session.getState().uploads['img-1']?.phase).toBe('failed');
    expect(session.getState().error).toBeNull();
    expect(transport.sent).toHaveLength(0);
  });

  it('retry depois de falha de upload sobe o mesmo arquivo e o mesmo clientId', async () => {
    const transport = new ScriptedTransport();
    transport.failUpload = true;
    const file = new File([new Uint8Array(12)], 'exame.png', { type: 'image/png' });
    const attachment = mustFile(file);
    const session = new ChatSession(transport, {
      createId: () => 'img-1',
      objectUrls: createFakeObjectUrls(),
    });
    await session.start('João', 'c1');
    await session.sendAttachment(attachment);
    transport.failUpload = false;
    await session.retry('img-1');
    expect(transport.uploads).toHaveLength(2);
    expect(transport.uploads[1]?.clientId).toBe('img-1');
    expect(transport.uploads[1]?.file).toBe(file);
    expect(transport.uploads[0]?.file).toBe(file);
    expect(session.getState().uploads).toEqual({});
    expect(transport.sent[0]?.clientId).toBe('img-1');
    expect(transport.sent[0]?.payload).toMatchObject({ type: 'image', url: 'uploaded:exame.png' });
  });

  it('retry depois de falha do send reusa a URL remota sem novo upload', async () => {
    const transport = new ScriptedTransport();
    transport.failSend = true;
    const session = new ChatSession(transport, {
      createId: () => 'img-1',
      objectUrls: createFakeObjectUrls(),
    });
    await session.start('João', 'c1');
    await session.sendAttachment(mustAttach('exame.png', 'image/png', 12), 'rx');
    expect(transport.uploads).toHaveLength(1);
    expect(session.getState().error).toMatch(/enviar/i);
    transport.failSend = false;
    await session.retry('img-1');
    expect(transport.uploads).toHaveLength(1);
    expect(transport.sent).toHaveLength(2);
    expect(transport.sent[1]?.payload).toMatchObject({
      type: 'image',
      url: 'uploaded:exame.png',
      caption: 'rx',
    });
  });

  it('cancelUpload remove a mensagem e revoga o preview', async () => {
    const urls = createFakeObjectUrls();
    const transport = new ScriptedTransport();
    transport.holdUpload = true;
    const session = new ChatSession(transport, { createId: () => 'img-1', objectUrls: urls });
    await session.start('João', 'c1');
    const sending = session.sendAttachment(mustAttach('exame.png', 'image/png', 12));
    expect(session.getState().uploads['img-1']?.phase).toBe('uploading');
    session.cancelUpload('img-1');
    expect(transport.uploads[0]?.signal.aborted).toBe(true);
    expect(session.getState().messages.some((message) => message.type === 'image')).toBe(false);
    expect(session.getState().uploads).toEqual({});
    expect(urls.revoked).toContain('blob:fake/1');
    await sending;
  });

  it('cancelUpload em failed também remove', async () => {
    const urls = createFakeObjectUrls();
    const transport = new ScriptedTransport();
    transport.failUpload = true;
    const session = new ChatSession(transport, { createId: () => 'img-1', objectUrls: urls });
    await session.start('João', 'c1');
    await session.sendAttachment(mustAttach('exame.png', 'image/png', 12));
    session.cancelUpload('img-1');
    expect(session.getState().messages.some((message) => message.type === 'image')).toBe(false);
    expect(urls.revoked).toContain('blob:fake/1');
  });

  it('cancelUpload sem entrada é no-op', async () => {
    const session = new ChatSession(new ScriptedTransport(), { objectUrls: createFakeObjectUrls() });
    await session.start('João', 'c1');
    session.cancelUpload('inexistente');
    expect(session.getState().messages).toHaveLength(0);
  });

  it('ignora progresso e resolução de tentativa antiga', async () => {
    const transport = new ScriptedTransport();
    transport.holdUpload = true;
    const session = new ChatSession(transport, {
      createId: () => 'img-1',
      objectUrls: createFakeObjectUrls(),
    });
    await session.start('João', 'c1');
    const first = session.sendAttachment(mustAttach('exame.png', 'image/png', 100));
    transport.rejectUpload(0, new Error('falha 1'));
    await first;
    transport.holdUpload = true;
    const second = session.retry('img-1');
    transport.progressUpload(0, 80);
    expect(session.getState().uploads['img-1']).toMatchObject({ phase: 'uploading', loaded: 0 });
    transport.resolveUpload(1, 'blob:remote/2');
    await second;
    expect(session.getState().uploads).toEqual({});
  });

  it('start e stop durante upload abortam, revogam e esvaziam uploads', async () => {
    const urls = createFakeObjectUrls();
    const transport = new ScriptedTransport();
    transport.holdUpload = true;
    const session = new ChatSession(transport, { createId: () => 'img-1', objectUrls: urls });
    await session.start('João', 'c1');
    const sending = session.sendAttachment(mustAttach('exame.png', 'image/png', 12));
    await session.start('João', 'c2');
    expect(session.getState().uploads).toEqual({});
    expect(urls.revoked.length).toBeGreaterThan(0);
    await sending;

    transport.holdUpload = true;
    const again = session.sendAttachment(mustAttach('exame.png', 'image/png', 12));
    session.stop();
    expect(session.getState().uploads).toEqual({});
    await again;
  });

  it('reconectar com histórico não revoga a URL remota da mídia já enviada', async () => {
    const urls = createFakeObjectUrls();
    const transport = new MockTransport({
      delays: { ...instant, uploadChunkMs: 0 },
      objectUrls: urls,
    });
    const session = new ChatSession(transport, { createId: () => 'img-1', objectUrls: urls });
    await session.start('João', 'c1');
    await session.sendAttachment(mustAttach('exame.png', 'image/png', 12));
    const image = session.getState().messages.find((message) => message.type === 'image');
    expect(image?.type).toBe('image');
    if (image?.type !== 'image') {
      throw new Error('esperava imagem');
    }
    const remoteUrl = image.url;
    expect(urls.revoked).not.toContain(remoteUrl);
    await transport.connect({ conversationId: 'c1', patientName: 'João' });
    expect(urls.revoked).not.toContain(remoteUrl);
    expect(session.getState().messages.find((message) => message.type === 'image')).toMatchObject({
      url: remoteUrl,
    });
    await session.start('João', 'c2');
    expect(urls.revoked).toContain(remoteUrl);
  });

  it('SessionAbortedError no upload sem ended não deixa a bolha em enviando', async () => {
    const transport = new ScriptedTransport();
    transport.holdUpload = true;
    const session = new ChatSession(transport, {
      createId: () => 'img-1',
      objectUrls: createFakeObjectUrls(),
    });
    await session.start('João', 'c1');
    const sending = session.sendAttachment(mustAttach('exame.png', 'image/png', 12));
    expect(session.getState().messages.find((message) => message.type === 'image')?.status).toBe('sending');
    transport.rejectUpload(0, new SessionAbortedError());
    await sending;
    expect(session.getState().ended).toBe(false);
    const image = session.getState().messages.find((message) => message.type === 'image');
    expect(image).toBeDefined();
    expect(image?.status).toBe('error');
    expect(session.getState().uploads['img-1']?.phase).toBe('failed');
  });

  it('connect do mock durante o upload não deixa a bolha em enviando', async () => {
    vi.useFakeTimers();
    const urls = createFakeObjectUrls();
    const transport = new MockTransport({
      delays: { ...instant, uploadChunkMs: 20 },
      uploadChunks: 5,
      objectUrls: urls,
    });
    const session = new ChatSession(transport, { createId: () => 'img-1', objectUrls: urls });
    const starting = session.start('João', 'c1');
    await vi.runAllTimersAsync();
    await starting;
    const sending = session.sendAttachment(mustAttach('exame.png', 'image/png', 12));
    await vi.advanceTimersByTimeAsync(20);
    expect(session.getState().uploads['img-1']?.phase).toBe('uploading');
    const reconnecting = transport.connect({ conversationId: 'c1', patientName: 'João' });
    await vi.runAllTimersAsync();
    await sending;
    await reconnecting;
    expect(session.getState().ended).toBe(false);
    const image = session.getState().messages.find((message) => message.type === 'image');
    expect(image).toBeDefined();
    expect(image?.status).toBe('error');
    expect(session.getState().uploads['img-1']?.phase).toBe('failed');
    vi.useRealTimers();
  });

  it('reconnect não derruba upload em andamento', async () => {
    const transport = new ScriptedTransport();
    transport.holdUpload = true;
    const session = new ChatSession(transport, {
      createId: () => 'img-1',
      objectUrls: createFakeObjectUrls(),
    });
    await session.start('João', 'c1');
    const sending = session.sendAttachment(mustAttach('exame.png', 'image/png', 12));
    await session.reconnect();
    expect(session.getState().uploads['img-1']?.phase).toBe('uploading');
    transport.resolveUpload(0, 'blob:remote/1');
    await sending;
    expect(transport.sent[0]?.payload).toMatchObject({ type: 'image', url: 'blob:remote/1' });
  });

  it('ended durante upload aborta e não dispara send da mídia', async () => {
    const urls = createFakeObjectUrls();
    const transport = new ScriptedTransport();
    transport.holdUpload = true;
    const session = new ChatSession(transport, { createId: () => 'img-1', objectUrls: urls });
    await session.start('João', 'c1');
    const sending = session.sendAttachment(mustAttach('exame.png', 'image/png', 12), 'rx');
    expect(session.getState().uploads['img-1']?.phase).toBe('uploading');
    transport.emit({ type: 'ended', conversationId: 'c1' });
    expect(session.getState().ended).toBe(true);
    expect(session.getState().uploads).toEqual({});
    expect(session.getState().messages.some((message) => message.type === 'image')).toBe(false);
    expect(transport.uploads[0]?.signal.aborted).toBe(true);
    transport.resolveUpload(0, 'blob:remote/1');
    await sending;
    expect(transport.sent.some((item) => item.payload.type !== 'text')).toBe(false);
    expect(urls.revoked).toContain('blob:fake/1');
  });

  it('ended torna sendAttachment no-op', async () => {
    const transport = new ScriptedTransport();
    const session = new ChatSession(transport, { objectUrls: createFakeObjectUrls() });
    await session.start('João', 'c1');
    transport.emit({ type: 'ended', conversationId: 'c1' });
    await session.sendAttachment(mustAttach('exame.png', 'image/png', 12));
    expect(transport.uploads).toHaveLength(0);
  });

  it('ignora rejeição tardia de retry depois de stop', async () => {
    const transport = new ScriptedTransport();
    transport.failSend = true;
    const session = new ChatSession(transport, {
      createId: () => 'img-1',
      objectUrls: createFakeObjectUrls(),
    });
    await session.start('João', 'c1');
    await session.sendAttachment(mustAttach('exame.png', 'image/png', 12));
    transport.failSend = false;
    transport.holdSend = true;
    const retrying = session.retry('img-1');
    session.stop();
    transport.rejectHeld();
    await retrying;
    expect(session.getState().error).toBeNull();
  });

  it('nunca mantém upload com status sent/delivered/read', async () => {
    const session = new ChatSession(
      new MockTransport({ delays: { ...instant, uploadChunkMs: 0 }, objectUrls: createFakeObjectUrls() }),
      { createId: () => 'img-1', objectUrls: createFakeObjectUrls() },
    );
    await session.start('João');
    await session.sendAttachment(mustAttach('exame.png', 'image/png', 12));
    const image = session.getState().messages.find((message) => message.type === 'image');
    expect(image?.status).toBe('read');
    expect(session.getState().uploads).toEqual({});
  });

  it('documento envia fileName e sizeBytes; áudio não leva legenda', async () => {
    const transport = new ScriptedTransport();
    const session = new ChatSession(transport, {
      createId: () => 'doc-1',
      objectUrls: createFakeObjectUrls(),
    });
    await session.start('João', 'c1');
    await session.sendAttachment(mustAttach('guia.pdf', 'application/pdf', 80), 'ignorada');
    expect(transport.sent[0]?.payload).toEqual({
      type: 'document',
      fileName: 'guia.pdf',
      mimeType: 'application/pdf',
      url: 'uploaded:guia.pdf',
      sizeBytes: 80,
    });
  });
});

function mustAttach(name: string, type: string, size: number) {
  return mustFile(new File([new Uint8Array(size)], name, { type }));
}

function mustFile(file: File) {
  const result = validateFiles([file]);
  if (!result?.ok) {
    throw new Error('anexo inválido no teste');
  }
  return result.attachment;
}

