import {
  asClientId,
  asIsoInstant,
  asMessageId,
  asQuickReplyId,
  asScheduledId,
  parseEmoji,
  validateFiles,
  type ChatMessage,
  type ConversationId,
  type TextMessage,
} from '@viavoip/internal-domain';
import { ForbiddenError, NotImplementedError } from '../transport/errors';
import { createFakeObjectUrls } from '../test/fakeObjectUrls';
import { ScriptedTransport } from '../test/scriptedTransport';
import { SessionAbortedError } from '../transport/abort';
import { MockTransport } from '../transport/MockTransport';
import { ChatSession } from './ChatSession';
import { DEFAULT_SESSION, ICS_TENANT_ID, ICS_USERS, LIVE_CONVERSATION_ID } from '../transport/mock/seed';

const instant = {
  connectMs: 0,
  sentMs: 0,
  deliveredMs: 0,
  readMs: 0,
};

function textMessage(partial: Omit<Partial<TextMessage>, 'id' | 'clientId'> & { id: string; text: string; clientId?: string }): TextMessage {
  const { id, clientId, ...rest } = partial;
  return {
    tenantId: ICS_TENANT_ID,
    conversationId: LIVE_CONVERSATION_ID,
    authorId: ICS_USERS.bruno,
    author: { id: 'agent', name: 'Colega' },
    timestamp: asIsoInstant('2026-11-10T12:00:00.000Z'),
    status: 'delivered',
    type: 'text',
    ...rest,
    id: asMessageId(id),
    ...(clientId ? { clientId: asClientId(clientId) } : {}),
  };
}

describe('ChatSession', () => {
  it('atualiza o status da mensagem enviada', async () => {
    const session = new ChatSession(new MockTransport({ simulateReceipts: true, delays: instant }), { createId: () => 'local-1' });
    await session.start();
    await session.send(LIVE_CONVERSATION_ID, { type: 'text', text: 'oi' });
    await vi.waitFor(() => {
      expect(live(session).messages.find((message) => message.authorId === ICS_USERS.carla)?.status).toBe('read');
    });
  });

  it('deduplica replay e não regride status, salvo erro', async () => {
    const transport = new ScriptedTransport();
    const session = new ChatSession(transport);
    await session.start();
    const first: ChatMessage = textMessage({
      id: 'm1',
      clientId: 'c1',
      authorId: ICS_USERS.carla,
      text: 'oi',
      status: 'sent',
    });
    transport.emit({ type: 'message', message: first });
    transport.emit({ type: 'message', message: { ...first, status: 'sending' } });
    transport.emit({ type: 'status', messageId: asMessageId('m1'), status: 'delivered' });
    transport.emit({ type: 'status', messageId: asMessageId('m1'), status: 'sent' });
    expect(live(session).messages).toHaveLength(1);
    expect(live(session).messages[0]?.status).toBe('delivered');
    transport.emit({ type: 'status', messageId: asMessageId('m1'), status: 'error' });
    expect(live(session).messages[0]?.status).toBe('error');
  });

  it('guarda status que chega antes da mensagem', async () => {
    const transport = new ScriptedTransport();
    const session = new ChatSession(transport);
    await session.start();
    transport.emit({ type: 'status', messageId: asMessageId('late'), clientId: asClientId('late'), status: 'delivered' });
    expect(live(session).messages).toHaveLength(0);
    transport.emit({
      type: 'message',
      message: textMessage({ id: 'late', clientId: 'late', authorId: ICS_USERS.carla, text: 'oi', status: 'sending' }),
    });
    expect(live(session).messages).toHaveLength(1);
    expect(live(session).messages[0]?.status).toBe('delivered');
  });

  it('associa clientId e id do servidor e mescla pendências pelo maior rank', async () => {
    const transport = new ScriptedTransport();
    const session = new ChatSession(transport);
    await session.start();
    transport.emit({ type: 'status', messageId: asMessageId('srv-1'), status: 'read' });
    transport.emit({ type: 'status', messageId: asMessageId('cid-1'), clientId: asClientId('cid-1'), status: 'sent' });
    transport.emit({
      type: 'message',
      message: textMessage({
        id: 'srv-1',
        clientId: 'cid-1',
        authorId: ICS_USERS.carla,
        text: 'oi',
        status: 'sending',
      }),
    });
    expect(live(session).messages).toHaveLength(1);
    expect(live(session).messages[0]?.id).toBe('srv-1');
    expect(live(session).messages[0]?.status).toBe('read');

    transport.emit({ type: 'status', messageId: asMessageId('srv-1'), clientId: asClientId('cid-1'), status: 'delivered' });
    expect(live(session).messages[0]?.status).toBe('read');
  });

  it('marca erro de connect e de send sem perder o texto', async () => {
    const transport = new ScriptedTransport();
    transport.failConnect = true;
    const session = new ChatSession(transport, { createId: () => 'cid-1' });
    await session.start();
    expect(session.getState().connection).toBe('error');
    expect(session.getState().error).toMatch(/conectar/i);

    transport.failConnect = false;
    await session.reconnect();
    expect(session.getState().connection).toBe('connected');
    expect(session.getState().error).toBeNull();

    transport.failSend = true;
    await session.send(LIVE_CONVERSATION_ID, { type: 'text', text: 'texto preservado' });
    const client = live(session).messages.find((message) => message.authorId === ICS_USERS.carla);
    expect(client?.type).toBe('text');
    if (client?.type !== 'text') {
      throw new Error('esperava texto');
    }
    expect(client.text).toBe('texto preservado');
    expect(client.status).toBe('error');
    expect(session.getState().error).toMatch(/enviar/i);

    transport.failSend = false;
    await session.retry(LIVE_CONVERSATION_ID, client.id);
    expect(live(session).messages.find((message) => message.authorId === ICS_USERS.carla)?.status).toBe(
      'sending',
    );
    expect(transport.sent).toHaveLength(2);
    expect(transport.sent[1]?.clientId).toBe('cid-1');
  });

  it('reconectar preserva histórico e mensagem em erro', async () => {
    const transport = new ScriptedTransport();
    const session = new ChatSession(transport, { createId: () => 'keep-1' });
    await session.start();
    transport.failSend = true;
    await session.send(LIVE_CONVERSATION_ID, { type: 'text', text: 'não apague' });
    expect(live(session).messages.some((message) => message.status === 'error')).toBe(true);

    await session.reconnect();
    const kept = live(session).messages.find((message) => message.authorId === ICS_USERS.carla);
    expect(kept?.type).toBe('text');
    if (kept?.type !== 'text') {
      throw new Error('esperava texto');
    }
    expect(kept.text).toBe('não apague');
    expect(kept.status).toBe('error');
    expect(session.getState().error).toBeNull();
  });

  it('um novo start limpa o que era só local (mensagem em erro) e as conversas anteriores', async () => {
    const transport = new ScriptedTransport();
    const session = new ChatSession(transport);
    await session.start();
    transport.failSend = true;
    await session.send(LIVE_CONVERSATION_ID, { type: 'text', text: '1' });
    expect(live(session).messages).toHaveLength(1);
    await session.start();
    expect(live(session).messages).toEqual([]);
    expect(session.getState().error).toBeNull();
  });

  it('um novo start na mesma conversa traz o histórico do servidor sem duplicar', async () => {
    const session = new ChatSession(new MockTransport({ delays: instant }), { createId: () => 'local-1' });
    await session.start();
    await session.send(LIVE_CONVERSATION_ID, { type: 'text', text: '1' });
    await session.start();
    const own = live(session).messages.filter((message) => message.authorId === ICS_USERS.carla);
    expect(own).toHaveLength(1);
    expect(own[0]).toMatchObject({ type: 'text', text: '1', clientId: 'local-1' });
  });

  it('ignora rejeição tardia de send após restart e após unmount', async () => {
    const transport = new ScriptedTransport();
    const session = new ChatSession(transport, { createId: () => 'old-1' });
    await session.start();
    transport.holdSend = true;
    const first = session.send(LIVE_CONVERSATION_ID, { type: 'text', text: 'antiga' });
    await session.start();
    transport.rejectHeld();
    await first;
    expect(session.getState().error).toBeNull();
    expect(live(session).messages.find((message) => message.authorId === ICS_USERS.carla)).toBeUndefined();

    transport.holdSend = true;
    const second = session.send(LIVE_CONVERSATION_ID, { type: 'text', text: 'depois' });
    session.stop();
    transport.rejectHeld();
    await second;
    const leftover = live(session).messages.find((message) => message.authorId === ICS_USERS.carla);
    expect(leftover?.status).toBe('sending');
    expect(session.getState().error).toBeNull();
  });

  it('envia payload de mídia pelo transporte e marca erro sem UI', async () => {
    const transport = new ScriptedTransport();
    transport.failSend = true;
    const session = new ChatSession(transport, { createId: () => 'img-1' });
    await session.start();
    await session.send(LIVE_CONVERSATION_ID, { type: 'image', mimeType: 'image/jpeg', url: 'blob:preview', caption: 'rx' });
    expect(transport.sent[0]?.payload).toEqual({
      type: 'image',
      mimeType: 'image/jpeg',
      url: 'blob:preview',
      caption: 'rx',
    });
    const image = live(session).messages.find((message) => message.type === 'image');
    expect(image?.status).toBe('error');
    expect(image?.type).toBe('image');
  });

  it('ignora eventos da sessão anterior após stop', async () => {
    const transport = new ScriptedTransport();
    const session = new ChatSession(transport);
    await session.start();
    session.stop();
    transport.emit({
      type: 'message',
      message: textMessage({ id: 'stale', text: 'não deveria aparecer' }),
    });
    expect(live(session).messages).toHaveLength(0);
  });

  it('sendAttachment sobe, troca a URL, envia e chega a lida', async () => {
    const urls = createFakeObjectUrls();
    const session = new ChatSession(
      new MockTransport({ simulateReceipts: true, delays: { ...instant, uploadChunkMs: 0 }, objectUrls: urls }),
      { createId: () => 'img-1', objectUrls: urls },
    );
    await session.start();
    const createdBefore = urls.created.length;
    await session.sendAttachment(LIVE_CONVERSATION_ID, mustAttach('rx.png', 'image/png', 40), 'exame');
    const image = live(session).messages.find((message) => message.type === 'image');
    expect(image?.status).toBe('read');
    expect(image?.type).toBe('image');
    if (image?.type !== 'image') {
      throw new Error('esperava imagem');
    }
    expect(image.caption).toBe('exame');
    expect(image.url).toMatch(/^blob:fake\//);
    expect(live(session).uploads).toEqual({});
    expect(urls.revoked).toContain(urls.created[createdBefore]);
  });

  it('insere otimista com preview e progresso só quando o percentual inteiro muda', async () => {
    const urls = createFakeObjectUrls();
    const transport = new ScriptedTransport();
    transport.holdUpload = true;
    const session = new ChatSession(transport, { createId: () => 'img-1', objectUrls: urls });
    await session.start();
    const sending = session.sendAttachment(LIVE_CONVERSATION_ID, mustAttach('rx.png', 'image/png', 100));
    const optimistic = live(session).messages.find((message) => message.type === 'image');
    expect(optimistic?.status).toBe('sending');
    expect(optimistic?.type).toBe('image');
    if (optimistic?.type !== 'image') {
      throw new Error('esperava imagem');
    }
    expect(optimistic.url).toBe('blob:fake/1');
    expect(live(session).uploads['img-1']).toMatchObject({
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
    expect(live(session).uploads['img-1']).toMatchObject({ loaded: 20 });
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
    await session.start();
    await session.sendAttachment(LIVE_CONVERSATION_ID, mustAttach('exame.png', 'image/png', 12));
    expect(live(session).messages.find((message) => message.type === 'image')?.status).toBe('error');
    expect(live(session).uploads['img-1']?.phase).toBe('failed');
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
    await session.start();
    await session.sendAttachment(LIVE_CONVERSATION_ID, attachment);
    transport.failUpload = false;
    await session.retry(LIVE_CONVERSATION_ID, 'img-1');
    expect(transport.uploads).toHaveLength(2);
    expect(transport.uploads[1]?.clientId).toBe('img-1');
    expect(transport.uploads[1]?.file).toBe(file);
    expect(transport.uploads[0]?.file).toBe(file);
    expect(live(session).uploads).toEqual({});
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
    await session.start();
    await session.sendAttachment(LIVE_CONVERSATION_ID, mustAttach('exame.png', 'image/png', 12), 'rx');
    expect(transport.uploads).toHaveLength(1);
    expect(session.getState().error).toMatch(/enviar/i);
    transport.failSend = false;
    await session.retry(LIVE_CONVERSATION_ID, 'img-1');
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
    await session.start();
    const sending = session.sendAttachment(LIVE_CONVERSATION_ID, mustAttach('exame.png', 'image/png', 12));
    expect(live(session).uploads['img-1']?.phase).toBe('uploading');
    session.cancelUpload(LIVE_CONVERSATION_ID, 'img-1');
    expect(transport.uploads[0]?.signal.aborted).toBe(true);
    expect(live(session).messages.some((message) => message.type === 'image')).toBe(false);
    expect(live(session).uploads).toEqual({});
    expect(urls.revoked).toContain('blob:fake/1');
    await sending;
  });

  it('cancelUpload em failed também remove', async () => {
    const urls = createFakeObjectUrls();
    const transport = new ScriptedTransport();
    transport.failUpload = true;
    const session = new ChatSession(transport, { createId: () => 'img-1', objectUrls: urls });
    await session.start();
    await session.sendAttachment(LIVE_CONVERSATION_ID, mustAttach('exame.png', 'image/png', 12));
    session.cancelUpload(LIVE_CONVERSATION_ID, 'img-1');
    expect(live(session).messages.some((message) => message.type === 'image')).toBe(false);
    expect(urls.revoked).toContain('blob:fake/1');
  });

  it('cancelUpload sem entrada é no-op', async () => {
    const session = new ChatSession(new ScriptedTransport(), { objectUrls: createFakeObjectUrls() });
    await session.start();
    session.cancelUpload(LIVE_CONVERSATION_ID, 'inexistente');
    expect(live(session).messages).toHaveLength(0);
  });

  it('ignora progresso e resolução de tentativa antiga', async () => {
    const transport = new ScriptedTransport();
    transport.holdUpload = true;
    const session = new ChatSession(transport, {
      createId: () => 'img-1',
      objectUrls: createFakeObjectUrls(),
    });
    await session.start();
    const first = session.sendAttachment(LIVE_CONVERSATION_ID, mustAttach('exame.png', 'image/png', 100));
    transport.rejectUpload(0, new Error('falha 1'));
    await first;
    transport.holdUpload = true;
    const second = session.retry(LIVE_CONVERSATION_ID, 'img-1');
    transport.progressUpload(0, 80);
    expect(live(session).uploads['img-1']).toMatchObject({ phase: 'uploading', loaded: 0 });
    transport.resolveUpload(1, 'blob:remote/2');
    await second;
    expect(live(session).uploads).toEqual({});
  });

  it('start e stop durante upload abortam, revogam e esvaziam uploads', async () => {
    const urls = createFakeObjectUrls();
    const transport = new ScriptedTransport();
    transport.holdUpload = true;
    const session = new ChatSession(transport, { createId: () => 'img-1', objectUrls: urls });
    await session.start();
    const sending = session.sendAttachment(LIVE_CONVERSATION_ID, mustAttach('exame.png', 'image/png', 12));
    await session.start();
    expect(live(session).uploads).toEqual({});
    expect(urls.revoked.length).toBeGreaterThan(0);
    await sending;

    transport.holdUpload = true;
    const again = session.sendAttachment(LIVE_CONVERSATION_ID, mustAttach('exame.png', 'image/png', 12));
    session.stop();
    expect(live(session).uploads).toEqual({});
    await again;
  });

  it('reconectar com histórico não revoga a URL remota da mídia já enviada', async () => {
    const urls = createFakeObjectUrls();
    const transport = new MockTransport({
      delays: { ...instant, uploadChunkMs: 0 },
      objectUrls: urls,
    });
    const session = new ChatSession(transport, { createId: () => 'img-1', objectUrls: urls });
    await session.start();
    await session.sendAttachment(LIVE_CONVERSATION_ID, mustAttach('exame.png', 'image/png', 12));
    const image = live(session).messages.find((message) => message.type === 'image');
    expect(image?.type).toBe('image');
    if (image?.type !== 'image') {
      throw new Error('esperava imagem');
    }
    const remoteUrl = image.url;
    expect(urls.revoked).not.toContain(remoteUrl);
    await transport.connect(DEFAULT_SESSION);
    expect(urls.revoked).not.toContain(remoteUrl);
    expect(live(session).messages.find((message) => message.type === 'image')).toMatchObject({
      url: remoteUrl,
    });
    session.stop();
    expect(urls.revoked).toContain(remoteUrl);
  });

  it('SessionAbortedError no upload não deixa a bolha em enviando', async () => {
    const transport = new ScriptedTransport();
    transport.holdUpload = true;
    const session = new ChatSession(transport, {
      createId: () => 'img-1',
      objectUrls: createFakeObjectUrls(),
    });
    await session.start();
    const sending = session.sendAttachment(LIVE_CONVERSATION_ID, mustAttach('exame.png', 'image/png', 12));
    expect(live(session).messages.find((message) => message.type === 'image')?.status).toBe('sending');
    transport.rejectUpload(0, new SessionAbortedError());
    await sending;
    const image = live(session).messages.find((message) => message.type === 'image');
    expect(image).toBeDefined();
    expect(image?.status).toBe('error');
    expect(live(session).uploads['img-1']?.phase).toBe('failed');
  });

  it('retry após SessionAbortedError não duplica a mensagem e reusa o clientId', async () => {
    const transport = new ScriptedTransport();
    transport.holdUpload = true;
    const session = new ChatSession(transport, {
      createId: () => 'img-1',
      objectUrls: createFakeObjectUrls(),
    });
    await session.start();
    const sending = session.sendAttachment(LIVE_CONVERSATION_ID, mustAttach('exame.png', 'image/png', 12));
    transport.rejectUpload(0, new SessionAbortedError());
    await sending;
    expect(live(session).messages.filter((message) => message.type === 'image')).toHaveLength(1);
    transport.holdUpload = false;
    await session.retry(LIVE_CONVERSATION_ID, 'img-1');
    expect(live(session).messages.filter((message) => message.type === 'image')).toHaveLength(1);
    expect(transport.uploads).toHaveLength(2);
    expect(transport.uploads[1]?.clientId).toBe('img-1');
    expect(transport.sent).toHaveLength(1);
    expect(transport.sent[0]?.clientId).toBe('img-1');
  });

  it('connect do mock na mesma conversa durante o upload deixa a bolha chegar a enviada', async () => {
    vi.useFakeTimers();
    const urls = createFakeObjectUrls();
    const transport = new MockTransport({ simulateReceipts: true,
      delays: { ...instant, uploadChunkMs: 20 },
      uploadChunks: 5,
      objectUrls: urls,
    });
    const session = new ChatSession(transport, { createId: () => 'img-1', objectUrls: urls });
    const starting = session.start();
    await vi.runAllTimersAsync();
    await starting;
    const sending = session.sendAttachment(LIVE_CONVERSATION_ID, mustAttach('exame.png', 'image/png', 12));
    await vi.advanceTimersByTimeAsync(20);
    expect(live(session).uploads['img-1']?.phase).toBe('uploading');
    const reconnecting = transport.connect(DEFAULT_SESSION);
    await vi.runAllTimersAsync();
    await sending;
    await reconnecting;
    const image = live(session).messages.find((message) => message.type === 'image');
    expect(image).toBeDefined();
    expect(image?.status).toBe('read');
    expect(live(session).uploads).toEqual({});
    vi.useRealTimers();
  });

  it('reconnect não derruba upload em andamento', async () => {
    const transport = new ScriptedTransport();
    transport.holdUpload = true;
    const session = new ChatSession(transport, {
      createId: () => 'img-1',
      objectUrls: createFakeObjectUrls(),
    });
    await session.start();
    const sending = session.sendAttachment(LIVE_CONVERSATION_ID, mustAttach('exame.png', 'image/png', 12));
    await session.reconnect();
    expect(live(session).uploads['img-1']?.phase).toBe('uploading');
    transport.resolveUpload(0, 'blob:remote/1');
    await sending;
    expect(transport.sent[0]?.payload).toMatchObject({ type: 'image', url: 'blob:remote/1' });
  });

  it('ignora rejeição tardia de retry depois de stop', async () => {
    const transport = new ScriptedTransport();
    transport.failSend = true;
    const session = new ChatSession(transport, {
      createId: () => 'img-1',
      objectUrls: createFakeObjectUrls(),
    });
    await session.start();
    await session.sendAttachment(LIVE_CONVERSATION_ID, mustAttach('exame.png', 'image/png', 12));
    transport.failSend = false;
    transport.holdSend = true;
    const retrying = session.retry(LIVE_CONVERSATION_ID, 'img-1');
    session.stop();
    transport.rejectHeld();
    await retrying;
    expect(session.getState().error).toBeNull();
  });

  it('nunca mantém upload com status sent/delivered/read', async () => {
    const session = new ChatSession(
      new MockTransport({ simulateReceipts: true, delays: { ...instant, uploadChunkMs: 0 }, objectUrls: createFakeObjectUrls() }),
      { createId: () => 'img-1', objectUrls: createFakeObjectUrls() },
    );
    await session.start();
    await session.sendAttachment(LIVE_CONVERSATION_ID, mustAttach('exame.png', 'image/png', 12));
    const image = live(session).messages.find((message) => message.type === 'image');
    expect(image?.status).toBe('read');
    expect(live(session).uploads).toEqual({});
  });

  it('documento envia fileName e sizeBytes; áudio não leva legenda', async () => {
    const transport = new ScriptedTransport();
    const session = new ChatSession(transport, {
      createId: () => 'doc-1',
      objectUrls: createFakeObjectUrls(),
    });
    await session.start();
    await session.sendAttachment(LIVE_CONVERSATION_ID, mustAttach('guia.pdf', 'application/pdf', 80), 'ignorada');
    expect(transport.sent[0]?.payload).toEqual({
      type: 'document',
      fileName: 'guia.pdf',
      mimeType: 'application/pdf',
      url: 'uploaded:guia.pdf',
      sizeBytes: 80,
    });
  });
});

describe('ChatSession v1: estado do Bootstrap e métodos ActionResult', () => {
  it('preenche os campos novos de estado a partir do Bootstrap e zera em novo start', async () => {
    const transport = new ScriptedTransport();
    const msgId = asMessageId('m-pin');
    const like = parseEmoji('👍');
    if (!like) throw new Error('emoji');
    transport.pinnedMessages = { [LIVE_CONVERSATION_ID]: [msgId] };
    transport.starred = [{ conversationId: LIVE_CONVERSATION_ID, messageId: msgId }];
    transport.reactions = { [msgId]: [{ emoji: like, userIds: [ICS_USERS.carla] }] };
    transport.quickReplies = [
      {
        id: asQuickReplyId('qr-1'),
        tenantId: ICS_TENANT_ID,
        shortcut: '/oi',
        text: 'Olá!',
        scope: { kind: 'personal', ownerId: ICS_USERS.carla },
        updatedAt: asIsoInstant('2026-11-10T10:00:00.000Z'),
      },
    ];
    const session = new ChatSession(transport);
    await session.start();

    const state = session.getState();
    expect(state.bootstrap?.serverNow).toBe(transport.serverNow);
    expect(state.presence[ICS_USERS.carla]?.status).toEqual({ kind: 'available' });
    expect(state.pinnedMessages[LIVE_CONVERSATION_ID]).toEqual([msgId]);
    expect(state.starred).toEqual([{ conversationId: LIVE_CONVERSATION_ID, messageId: msgId }]);
    expect(state.reactions[msgId]).toHaveLength(1);
    expect(state.quickReplies).toHaveLength(1);
    expect(state.prefs).toEqual({});
    expect(state.polls).toEqual({});
    expect(state.scheduled).toEqual([]);

    transport.holdConnect = true;
    const restarting = session.start();
    expect(session.getState().bootstrap).toBeNull();
    expect(session.getState().quickReplies).toEqual([]);
    transport.releaseConnect();
    await restarting;
    session.stop();
  });

  it('delega operações v1 ao transporte e devolve ActionResult em pt-BR', async () => {
    const transport = new ScriptedTransport();
    const session = new ChatSession(transport, { createId: () => 'cid-v1' });
    await session.start();
    const msgId = asMessageId('m-1');
    const like = parseEmoji('👍');
    if (!like) throw new Error('emoji');

    await session.send(LIVE_CONVERSATION_ID, 'olá', { replyTo: msgId, mentions: [ICS_USERS.bruno] });
    expect(transport.sent[0]).toMatchObject({
      replyTo: msgId,
      mentions: [ICS_USERS.bruno],
    });

    expect(await session.history({ conversationId: LIVE_CONVERSATION_ID, limit: 20 })).toEqual({
      ok: true,
      value: { messages: [], hasMore: false },
    });
    expect(await session.react({ conversationId: LIVE_CONVERSATION_ID, messageId: msgId, emoji: like })).toEqual({
      ok: true,
      value: undefined,
    });
    expect(await session.editMessage({ conversationId: LIVE_CONVERSATION_ID, messageId: msgId, text: 'novo' })).toMatchObject({
      ok: true,
      value: { text: 'novo' },
    });
    expect(await session.deleteMessage({ conversationId: LIVE_CONVERSATION_ID, messageId: msgId, scope: 'everyone' })).toEqual({
      ok: true,
      value: undefined,
    });
    expect(
      await session.forward({
        sources: [{ conversationId: LIVE_CONVERSATION_ID, messageId: msgId }],
        targets: [LIVE_CONVERSATION_ID],
      }),
    ).toMatchObject({ ok: true, value: { perTarget: [{ target: LIVE_CONVERSATION_ID, outcome: 'sent' }] } });
    expect(transport.callsOf('forward')[0]?.clientId).toBe('cid-v1');
    expect(await session.setStar({ conversationId: LIVE_CONVERSATION_ID, messageId: msgId, starred: true })).toEqual({
      ok: true,
      value: undefined,
    });
    expect(await session.pinMessage({ conversationId: LIVE_CONVERSATION_ID, messageId: msgId, pinned: true })).toEqual({
      ok: true,
      value: undefined,
    });
    expect(await session.messageInfo({ conversationId: LIVE_CONVERSATION_ID, messageId: msgId })).toEqual({
      ok: true,
      value: { messageId: msgId, recipients: [] },
    });
    expect(await session.searchMessages({ query: 'olá', limit: 10 })).toEqual({ ok: true, value: [] });
    expect(await session.setPresence({ status: 'pause', reason: 'lanche' })).toMatchObject({
      ok: true,
      value: { status: { kind: 'pause', reason: 'lanche' } },
    });
    expect(await session.setConversationPrefs({ conversationId: LIVE_CONVERSATION_ID, pinned: true })).toMatchObject({
      ok: true,
      value: { archived: false },
    });
    expect(await session.votePoll({ conversationId: LIVE_CONVERSATION_ID, messageId: msgId, optionIds: [] })).toMatchObject({
      ok: true,
      value: { closed: false },
    });
    expect(await session.closePoll({ conversationId: LIVE_CONVERSATION_ID, messageId: msgId })).toEqual({
      ok: true,
      value: undefined,
    });
    expect(
      await session.schedule({
        kind: 'message',
        conversationId: LIVE_CONVERSATION_ID,
        text: 'agendada',
        sendAt: asIsoInstant('2026-11-20T10:00:00.000Z'),
      }),
    ).toMatchObject({ ok: true, value: { kind: 'message', text: 'agendada' } });
    expect(await session.cancelScheduled(asScheduledId('sched-1'))).toMatchObject({
      ok: true,
      value: { state: { phase: 'canceled' } },
    });
    expect(
      await session.saveQuickReply({
        shortcut: '/ola',
        text: 'Olá!',
        scope: { kind: 'personal', ownerId: ICS_USERS.carla },
      }),
    ).toMatchObject({ ok: true, value: { shortcut: '/ola' } });
    expect(await session.deleteQuickReply(asQuickReplyId('qr-1'))).toEqual({ ok: true, value: undefined });

    transport.rejectMethod('editMessage', new ForbiddenError('window-expired'));
    expect(await session.editMessage({ conversationId: LIVE_CONVERSATION_ID, messageId: msgId, text: 'tarde' })).toEqual({
      ok: false,
      message: 'Operação não permitida: o prazo para esta alteração expirou.',
    });

    transport.rejectMethod('react', new NotImplementedError('react'));
    const unimplemented = await session.react({ conversationId: LIVE_CONVERSATION_ID, messageId: msgId, emoji: like });
    expect(unimplemented.ok).toBe(false);
    if (!unimplemented.ok) {
      expect(unimplemented.message).toMatch(/ainda não implementada/i);
    }

    session.stop();
  });
});

function live(session: ChatSession, id: ConversationId = LIVE_CONVERSATION_ID) {
  const thread = session.getState().conversations[id];
  if (!thread) {
    throw new Error(`conversa ausente na sessão: ${id}`);
  }
  return thread;
}

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

