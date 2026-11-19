import { asClientId } from '@viavoip/internal-domain';
import { asMessageId } from '@viavoip/internal-domain';
import { validateFiles } from '@viavoip/internal-domain';
import { asConversationId, directConversation, directConversationId, type ConversationId } from '@viavoip/internal-domain';
import type { TextMessage } from '@viavoip/internal-domain';
import { createFakeObjectUrls } from '../test/fakeObjectUrls';
import { ScriptedTransport } from '../test/scriptedTransport';
import { SessionAbortedError } from '../transport/abort';
import { MockBackend } from '../transport/mock/MockBackend';
import {
  BV_TENANT_ID,
  BV_USERS,
  DEFAULT_SESSION,
  bvDirectory,
  ICS_TENANT_ID,
  ICS_USERS,
  LIVE_CONVERSATION_ID,
  OTHER_CONVERSATION_ID,
  icsDirectory,
} from '../transport/mock/seed';
import { MockTransport } from '../transport/MockTransport';
import { ChatSession } from './ChatSession';

const C1 = LIVE_CONVERSATION_ID;
const C2 = OTHER_CONVERSATION_ID;
const instant = { connectMs: 0, sentMs: 0, deliveredMs: 0, readMs: 0, uploadChunkMs: 0 };

function incoming(id: string, conversationId: ConversationId, authorId = ICS_USERS.bruno, text = 'oi'): TextMessage {
  return {
    id: asMessageId(id),
    tenantId: ICS_TENANT_ID,
    conversationId,
    authorId,
    author: { id: authorId, name: 'Colega' },
    timestamp: '2026-11-12T12:00:00.000Z',
    status: 'delivered',
    type: 'text',
    text,
  };
}

function thread(session: ChatSession, id: ConversationId) {
  const found = session.getState().conversations[id];
  if (!found) {
    throw new Error(`conversa ausente: ${id}`);
  }
  return found;
}

function sequentialIds(prefix = 'id') {
  let n = 0;
  return () => {
    n += 1;
    return `${prefix}-${String(n)}`;
  };
}

function attach(name: string, size: number) {
  const result = validateFiles([new File([new Uint8Array(size)], name, { type: 'image/png' })]);
  if (!result?.ok) {
    throw new Error('anexo inválido no teste');
  }
  return result.attachment;
}

async function scripted(options: { objectUrls?: ReturnType<typeof createFakeObjectUrls> } = {}) {
  const transport = new ScriptedTransport();
  const urls = options.objectUrls ?? createFakeObjectUrls();
  const session = new ChatSession(transport, { createId: sequentialIds(), objectUrls: urls });
  await session.start();
  return { transport, session, urls };
}

describe('ChatSession multi-conversa: Bootstrap e seleção', () => {
  it('guarda tenant, me, diretório e as conversas do Bootstrap, ordenadas por atividade', async () => {
    const { session } = await scripted();
    const state = session.getState();
    expect(state.tenant?.id).toBe(ICS_TENANT_ID);
    expect(state.me?.id).toBe(ICS_USERS.carla);
    expect(state.directory?.tenantId).toBe(ICS_TENANT_ID);
    expect(Object.keys(state.conversations).sort()).toEqual([C1, C2].sort());
    expect(state.summaries.map((item) => item.id)).toHaveLength(2);
    expect(state.activeConversationId).toBeNull();
  });

  it('selectConversation antes do Bootstrap fica pendente e vale depois dele', async () => {
    const transport = new ScriptedTransport();
    transport.holdConnect = true;
    const session = new ChatSession(transport);
    const starting = session.start();
    session.selectConversation(C2);
    expect(session.getState().activeConversationId).toBe(C2);
    transport.releaseConnect();
    await starting;
    expect(session.getState().activeConversationId).toBe(C2);
  });

  it('selectConversation de conversa desconhecida é ignorado depois do Bootstrap', async () => {
    const { session } = await scripted();
    session.selectConversation(asConversationId('dm:ics:x:y'));
    expect(session.getState().activeConversationId).toBeNull();
  });
});

describe('ChatSession multi-conversa: isolamento entre conversas', () => {
  it('send em c1 com c2 aberto não altera c2', async () => {
    const { transport, session } = await scripted();
    session.selectConversation(C2);
    transport.emit({ type: 'message', message: incoming('m-c2', C2, ICS_USERS.camila) });
    transport.holdUpload = true;
    void session.sendAttachment(C2, attach('c2.png', 100));
    transport.progressUpload(0, 30);
    const before = thread(session, C2);

    await session.send(C1, 'só na c1');

    const after = thread(session, C2);
    expect(after.messages).toBe(before.messages);
    expect(after.unread).toBe(before.unread);
    expect(after.uploads).toEqual(before.uploads);
    expect(after.lastActivityAt).toBe(before.lastActivityAt);
    expect(thread(session, C1).messages).toHaveLength(1);
    expect(transport.sent.at(-1)).toMatchObject({ conversationId: C1 });
  });

  it('duas conversas com uploads simultâneos não se misturam', async () => {
    const urls = createFakeObjectUrls();
    const { transport, session } = await scripted({ objectUrls: urls });
    transport.holdUpload = true;
    const first = session.sendAttachment(C1, attach('a.png', 100));
    const second = session.sendAttachment(C2, attach('b.png', 200));
    expect(transport.uploads.map((upload) => upload.conversationId)).toEqual([C1, C2]);

    transport.progressUpload(0, 50);
    transport.progressUpload(1, 20);
    expect(Object.values(thread(session, C1).uploads)).toEqual([
      { phase: 'uploading', loaded: 50, total: 100, fileName: 'a.png' },
    ]);
    expect(Object.values(thread(session, C2).uploads)).toEqual([
      { phase: 'uploading', loaded: 20, total: 200, fileName: 'b.png' },
    ]);

    transport.resolveUpload(1, 'blob:remote/b');
    await second;
    expect(Object.keys(thread(session, C2).uploads)).toHaveLength(0);
    expect(Object.keys(thread(session, C1).uploads)).toHaveLength(1);
    expect(thread(session, C2).messages[0]).toMatchObject({ type: 'image', url: 'blob:remote/b' });
    expect(thread(session, C1).messages[0]).toMatchObject({ type: 'image', url: 'blob:fake/1' });

    transport.resolveUpload(0, 'blob:remote/a');
    await first;
    expect(thread(session, C1).messages[0]).toMatchObject({ type: 'image', url: 'blob:remote/a' });
    expect(transport.sent).toHaveLength(2);
    const byConversation = Object.fromEntries(transport.sent.map((request) => [request.conversationId, request]));
    expect(byConversation[C1]?.payload).toMatchObject({ url: 'blob:remote/a' });
    expect(byConversation[C2]?.payload).toMatchObject({ url: 'blob:remote/b' });
  });

  it('cancelar o upload de c1 não toca no de c2 e revoga só o preview de c1', async () => {
    const urls = createFakeObjectUrls();
    const { transport, session } = await scripted({ objectUrls: urls });
    transport.holdUpload = true;
    const first = session.sendAttachment(C1, attach('a.png', 100));
    void session.sendAttachment(C2, attach('b.png', 100));
    const [c1Key] = Object.keys(thread(session, C1).uploads);
    session.cancelUpload(C1, c1Key ?? '');
    await first;
    expect(transport.uploads[0]?.signal.aborted).toBe(true);
    expect(transport.uploads[1]?.signal.aborted).toBe(false);
    expect(urls.revoked).toEqual(['blob:fake/1']);
    expect(thread(session, C1).messages).toHaveLength(0);
    expect(thread(session, C2).messages).toHaveLength(1);
    expect(Object.keys(thread(session, C2).uploads)).toHaveLength(1);
  });

  it('retry reusa clientId e conversationId (envio de texto)', async () => {
    const { transport, session } = await scripted();
    transport.failSend = true;
    await session.send(C2, 'de novo');
    const failed = thread(session, C2).messages[0];
    expect(failed?.status).toBe('error');
    transport.failSend = false;
    await session.retry(C2, failed?.id ?? '');
    expect(transport.sent).toHaveLength(2);
    expect(transport.sent[1]?.conversationId).toBe(C2);
    expect(transport.sent[1]?.clientId).toBe(transport.sent[0]?.clientId);
    expect(transport.sent[1]?.payload).toEqual({ type: 'text', text: 'de novo' });
    expect(thread(session, C1).messages).toHaveLength(0);
  });

  it('retry reusa clientId e conversationId (upload falho)', async () => {
    const { transport, session } = await scripted();
    transport.failUpload = true;
    await session.sendAttachment(C2, attach('a.png', 10));
    const [clientId] = Object.keys(thread(session, C2).uploads);
    transport.failUpload = false;
    await session.retry(C2, clientId ?? '');
    expect(transport.uploads).toHaveLength(2);
    expect(transport.uploads[1]).toMatchObject({ conversationId: C2, clientId });
    expect(transport.sent[0]).toMatchObject({ conversationId: C2, clientId });
  });

  it('retry com a conversa errada é no-op', async () => {
    const { transport, session } = await scripted();
    transport.failSend = true;
    await session.send(C2, 'x');
    const id = thread(session, C2).messages[0]?.id ?? '';
    transport.failSend = false;
    await session.retry(C1, id);
    expect(transport.sent).toHaveLength(1);
  });

  it('eventos de status e digitação ficam na conversa certa', async () => {
    const { transport, session } = await scripted();
    transport.emit({ type: 'typing', userId: ICS_USERS.camila, isTyping: true, conversationId: C2 });
    expect(thread(session, C2).typing).toEqual({ isTyping: true, actorName: 'Camila Ribeiro' });
    expect(thread(session, C1).typing.isTyping).toBe(false);
    session.setTyping(C1, true);
    expect(transport.typing).toEqual([{ conversationId: C1, isTyping: true }]);
  });
});

describe('ChatSession multi-conversa: eventos', () => {
  it('descarta evento de outro tenant, mesmo com conversationId conhecido', async () => {
    const { transport, session } = await scripted();
    transport.emit({ type: 'message', tenantId: BV_TENANT_ID, message: { ...incoming('x', C1), tenantId: BV_TENANT_ID } });
    transport.emit({ type: 'message', tenantId: BV_TENANT_ID, message: incoming('y', C1) });
    transport.emit({ type: 'typing', tenantId: BV_TENANT_ID, conversationId: C1, userId: ICS_USERS.bruno, isTyping: true });
    transport.emit({ type: 'status', tenantId: BV_TENANT_ID, conversationId: C1, messageId: 'x', status: 'read' });
    expect(thread(session, C1).messages).toHaveLength(0);
    expect(thread(session, C1).typing.isTyping).toBe(false);
    expect(thread(session, C1).unread).toBe(0);
  });

  it('descarta mensagem de conversa desconhecida', async () => {
    const { transport, session } = await scripted();
    const ghost = asConversationId('dm:ics:fantasma:outro');
    transport.emit({ type: 'message', message: incoming('g', ghost) });
    expect(Object.keys(session.getState().conversations)).not.toContain(ghost);
  });

  it('evento conversation adiciona a conversa se eu participo e ignora se não', async () => {
    const { transport, session } = await scripted();
    const directory = icsDirectory();
    const carla = directory.users[ICS_USERS.carla];
    const diego = directory.users[ICS_USERS.diego];
    const ana = directory.users[ICS_USERS.ana];
    const elisa = directory.users[ICS_USERS.elisa];
    if (!carla || !diego || !ana || !elisa) {
      throw new Error('seed');
    }
    const mine = directConversation(carla, diego);
    const notMine = directConversation(ana, elisa);
    if (!mine.ok || !notMine.ok) {
      throw new Error('direta');
    }
    transport.emit({ type: 'conversation', tenantId: ICS_TENANT_ID, conversation: notMine.value });
    expect(session.getState().conversations[notMine.value.id]).toBeUndefined();
    transport.emit({ type: 'conversation', tenantId: ICS_TENANT_ID, conversation: mine.value });
    expect(thread(session, mine.value.id).messages).toEqual([]);
    transport.emit({ type: 'message', message: incoming('d1', mine.value.id, ICS_USERS.diego) });
    expect(thread(session, mine.value.id).unread).toBe(1);
  });

  it('mensagem em conversa não ativa incrementa unread, atualiza atividade e prévia; sem markRead', async () => {
    const { transport, session } = await scripted();
    session.selectConversation(C1);
    transport.emit({ type: 'message', message: incoming('m1', C2, ICS_USERS.camila, 'chegou') });
    transport.emit({ type: 'message', message: incoming('m1', C2, ICS_USERS.camila, 'chegou') });
    expect(thread(session, C2)).toMatchObject({
      unread: 1,
      preview: 'chegou',
      lastActivityAt: '2026-11-12T12:00:00.000Z',
    });
    expect(session.getState().summaries[0]?.id).toBe(C2);
    expect(transport.marked).toEqual([]);
  });

  it('mensagem na conversa ativa é marcada como lida na hora', async () => {
    const { transport, session } = await scripted();
    session.selectConversation(C1);
    transport.emit({ type: 'message', message: incoming('m1', C1) });
    expect(thread(session, C1).unread).toBe(0);
    expect(transport.marked).toEqual([{ conversationId: C1, upToMessageId: 'm1' }]);
  });

  it('selecionar a conversa zera o unread e chama markRead com a conversa certa', async () => {
    const { transport, session } = await scripted();
    transport.emit({ type: 'message', message: incoming('a1', C1) });
    transport.emit({ type: 'message', message: incoming('b1', C2, ICS_USERS.camila) });
    transport.emit({ type: 'message', message: incoming('b2', C2, ICS_USERS.camila) });
    expect(thread(session, C1).unread).toBe(1);
    expect(thread(session, C2).unread).toBe(2);
    session.selectConversation(C2);
    expect(thread(session, C2).unread).toBe(0);
    expect(thread(session, C1).unread).toBe(1);
    expect(transport.marked).toEqual([{ conversationId: C2, upToMessageId: 'b2' }]);
    session.selectConversation(C2);
    expect(transport.marked).toHaveLength(1);
  });

  it("'read' de outro usuário eleva meus status para read, só até a mensagem lida", async () => {
    const { transport, session } = await scripted();
    transport.emit({ type: 'message', message: incoming('s1', C1, ICS_USERS.carla, 'um') });
    transport.emit({ type: 'message', message: { ...incoming('s2', C1, ICS_USERS.carla, 'dois'), status: 'sent' } });
    transport.emit({ type: 'message', message: { ...incoming('s3', C1, ICS_USERS.carla, 'três'), status: 'sent' } });
    transport.emit({ type: 'read', tenantId: ICS_TENANT_ID, conversationId: C1, userId: ICS_USERS.bruno, upToMessageId: 's2' });
    expect(thread(session, C1).messages.map((message) => message.status)).toEqual(['read', 'read', 'sent']);
    // read de outro tenant é ignorado
    transport.emit({ type: 'read', tenantId: BV_TENANT_ID, conversationId: C1, userId: ICS_USERS.bruno, upToMessageId: 's3' });
    expect(thread(session, C1).messages[2]?.status).toBe('sent');
  });

  it("'read' meu (outra aba) zera o não lido", async () => {
    const { transport, session } = await scripted();
    transport.emit({ type: 'message', message: incoming('m1', C2, ICS_USERS.camila) });
    transport.emit({ type: 'read', tenantId: ICS_TENANT_ID, conversationId: C2, userId: ICS_USERS.carla, upToMessageId: 'm1' });
    expect(thread(session, C2).unread).toBe(0);
  });
});

describe('ChatSession multi-conversa: openDirect', () => {
  it('adiciona a conversa nova, seleciona e devolve o id', async () => {
    const session = new ChatSession(new MockTransport({ delays: instant }), { createId: sequentialIds() });
    await session.start();
    expect(session.getState().conversations[directConversationId(ICS_TENANT_ID, ICS_USERS.carla, ICS_USERS.diego)]).toBeUndefined();
    const id = await session.openDirect(ICS_USERS.diego);
    expect(id).toBe(directConversationId(ICS_TENANT_ID, ICS_USERS.carla, ICS_USERS.diego));
    expect(session.getState().activeConversationId).toBe(id);
    expect(thread(session, id ?? C1).messages).toEqual([]);
    // abrir de novo reaproveita a mesma conversa
    expect(await session.openDirect(ICS_USERS.diego)).toBe(id);
    expect(Object.keys(session.getState().conversations).filter((key) => key === id)).toHaveLength(1);
    await session.send(id ?? C1, 'olá, Diego');
    expect(thread(session, id ?? C1).messages).toHaveLength(1);
    session.stop();
  });

  it('usuário de outra empresa é recusado e a sessão fica sem a conversa', async () => {
    const session = new ChatSession(new MockTransport({ delays: instant }));
    await session.start();
    const before = Object.keys(session.getState().conversations).length;
    expect(await session.openDirect(BV_USERS.paula)).toBeUndefined();
    expect(session.getState().error).not.toBeNull();
    expect(Object.keys(session.getState().conversations)).toHaveLength(before);
    session.stop();
  });
});

describe('ChatSession multi-conversa: dois usuários no mesmo servidor', () => {
  it('cria, edita e deixa grupo removido somente para leitura na outra sessão', async () => {
    const backend = new MockBackend();
    const carla = new ChatSession(new MockTransport({ backend, delays: instant }), { createId: sequentialIds('c') });
    const ana = new ChatSession(new MockTransport({ backend, delays: instant }), { identity: { tenantId: ICS_TENANT_ID, userId: ICS_USERS.ana }, createId: sequentialIds('a') });
    await carla.start();
    await ana.start();
    const result = await carla.createGroup({ title: 'Equipe', memberIds: [ICS_USERS.carla, ICS_USERS.ana], ilhaId: null });
    if (!result.ok) throw new Error(result.message);
    const id = result.value.id;
    expect(thread(ana, id).readOnly).toBe(false);
    expect((await carla.updateGroup({ conversationId: id, remove: [ICS_USERS.ana] })).ok).toBe(true);
    expect(thread(ana, id).readOnly).toBe(true);
    carla.stop(); ana.stop(); backend.close();
  });
  it('a mensagem chega como não lida ao colega, e abrir a conversa a deixa lida para quem enviou', async () => {
    const backend = new MockBackend();
    const carla = new ChatSession(new MockTransport({ backend, delays: instant }), { createId: sequentialIds('c') });
    const bruno = new ChatSession(new MockTransport({ backend, delays: instant }), {
      identity: { tenantId: ICS_TENANT_ID, userId: ICS_USERS.bruno },
      createId: sequentialIds('b'),
    });
    await carla.start();
    await bruno.start();
    await carla.send(C1, 'oi, Bruno');
    await vi.waitFor(() => {
      expect(thread(bruno, C1).unread).toBe(1);
    });
    expect(thread(bruno, C1).preview).toBe('oi, Bruno');
    bruno.selectConversation(C1);
    await vi.waitFor(() => {
      expect(thread(carla, C1).messages[0]?.status).toBe('read');
    });
    expect(thread(bruno, C1).unread).toBe(0);
    carla.stop();
    bruno.stop();
  });
});

describe('ChatSession multi-conversa: mensagem em voo depois de reconectar', () => {
  it('o servidor recebeu: herda o status dele e chega a read, nunca fica em sending', async () => {
    const backend = new MockBackend();
    const transport = new MockTransport({ backend, delays: { ...instant, sentMs: 40 } });
    const bruno = new MockTransport({ backend, delays: instant });
    const session = new ChatSession(transport, { createId: () => 'voo-1' });
    await session.start();
    await bruno.connect({ tenantId: ICS_TENANT_ID, userId: ICS_USERS.bruno });
    await session.send(C1, 'em voo');
    expect(thread(session, C1).messages[0]?.status).toBe('sending');

    transport.disconnect();
    await session.reconnect();
    const status = thread(session, C1).messages[0]?.status;
    expect(status).not.toBe('sending');
    expect(['sent', 'delivered']).toContain(status);

    const serverId = thread(session, C1).messages[0]?.id ?? '';
    await bruno.markRead({ conversationId: C1, upToMessageId: serverId });
    await vi.waitFor(() => {
      expect(thread(session, C1).messages[0]?.status).toBe('read');
    });
    expect(thread(session, C1).messages).toHaveLength(1);
    session.stop();
    bruno.disconnect();
  });

  it('o servidor não recebeu: reenvia com o mesmo clientId e conversationId e chega a read', async () => {
    const transport = new ScriptedTransport();
    const session = new ChatSession(transport, { createId: () => 'voo-2' });
    await session.start();
    transport.holdSend = true;
    const first = session.send(C2, 'perdida');
    expect(thread(session, C2).messages[0]?.status).toBe('sending');

    transport.disconnect();
    transport.rejectHeld(new SessionAbortedError());
    await first;
    transport.holdSend = false;
    await session.reconnect();
    expect(transport.sent).toHaveLength(2);
    expect(transport.sent[1]).toMatchObject({ conversationId: C2, clientId: 'voo-2' });
    expect(thread(session, C2).messages).toHaveLength(1);

    transport.emit({ type: 'status', conversationId: C2, messageId: 'srv-1', clientId: 'voo-2', status: 'read' });
    expect(thread(session, C2).messages[0]?.status).toBe('read');
  });

  it('o servidor não recebeu e o reenvio falha: termina em error', async () => {
    const transport = new ScriptedTransport();
    const session = new ChatSession(transport, { createId: () => 'voo-3' });
    await session.start();
    transport.holdSend = true;
    const first = session.send(C1, 'perdida de vez');
    transport.disconnect();
    transport.rejectHeld(new SessionAbortedError());
    await first;
    transport.holdSend = false;
    transport.failSend = true;
    await session.reconnect();
    await vi.waitFor(() => {
      expect(thread(session, C1).messages[0]?.status).toBe('error');
    });
  });

  it('reconexão com histórico do servidor não duplica nem perde as outras conversas', async () => {
    const transport = new ScriptedTransport();
    const session = new ChatSession(transport, { createId: () => 'voo-4' });
    await session.start();
    transport.emit({ type: 'message', message: incoming('m-c2', C2, ICS_USERS.camila) });
    transport.recent = { [C1]: [incoming('srv-9', C1, ICS_USERS.bruno, 'perdi')] };
    transport.disconnect();
    await session.reconnect();
    expect(thread(session, C1).messages.map((message) => message.id)).toEqual(['srv-9']);
    expect(thread(session, C2).messages.map((message) => message.id)).toEqual(['m-c2']);
  });
});

describe('ChatSession multi-conversa: conversas que não são minhas', () => {
  function foreignDirects() {
    const bv = bvDirectory();
    const paula = bv.users[BV_USERS.paula];
    const rui = bv.users[BV_USERS.rui];
    const ics = icsDirectory();
    const ana = ics.users[ICS_USERS.ana];
    const elisa = ics.users[ICS_USERS.elisa];
    if (!paula || !rui || !ana || !elisa) {
      throw new Error('seed');
    }
    const otherTenant = directConversation(paula, rui);
    const notMine = directConversation(ana, elisa);
    if (!otherTenant.ok || !notMine.ok) {
      throw new Error('direta');
    }
    return { otherTenant: otherTenant.value, notMine: notMine.value };
  }

  it('openDirect que devolve conversa de outro tenant ou sem mim é ignorado, com erro', async () => {
    const { transport, session } = await scripted();
    const { otherTenant, notMine } = foreignDirects();
    for (const forced of [otherTenant, notMine]) {
      transport.openDirectResult = forced;
      expect(await session.openDirect(ICS_USERS.diego)).toBeUndefined();
      expect(session.getState().conversations[forced.id]).toBeUndefined();
      expect(session.getState().error).not.toBeNull();
    }
    expect(session.getState().activeConversationId).toBeNull();
  });

  it("evento 'conversation' de outro tenant (mesmo com tenantId do evento certo) é ignorado", async () => {
    const { transport, session } = await scripted();
    const { otherTenant } = foreignDirects();
    transport.emit({ type: 'conversation', tenantId: ICS_TENANT_ID, conversation: otherTenant });
    expect(session.getState().conversations[otherTenant.id]).toBeUndefined();
  });

  it('conversas de outro tenant ou sem mim no Bootstrap são ignoradas', async () => {
    const transport = new ScriptedTransport();
    const { otherTenant, notMine } = foreignDirects();
    transport.extraConversations = [otherTenant, notMine].map((conversation) => ({
      id: conversation.id,
      conversation,
      lastActivityAt: '2026-11-10T11:00:00.000Z',
      unread: 3,
    }));
    const session = new ChatSession(transport);
    await session.start();
    expect(Object.keys(session.getState().conversations).sort()).toEqual([C1, C2].sort());
  });
});

describe('ChatSession multi-conversa: rejeição tardia e reenvio idempotente', () => {
  it('rejeição tardia do envio pós-upload, depois de start(), não grava erro na sessão nova', async () => {
    const { transport, session } = await scripted();
    transport.holdUpload = true;
    const sending = session.sendAttachment(C1, attach('a.png', 10));
    transport.holdSend = true;
    transport.resolveUpload(0, 'blob:remote/a');
    await vi.waitFor(() => {
      expect(transport.sent).toHaveLength(1);
    });
    await session.start();
    transport.rejectHeld(new Error('falha tardia'));
    await sending;
    expect(session.getState().error).toBeNull();
    expect(thread(session, C1).messages).toEqual([]);
  });

  it('o MockTransport devolve o status atual no reenvio idempotente', async () => {
    const backend = new MockBackend();
    const transport = new MockTransport({ backend, delays: instant });
    await transport.connect(DEFAULT_SESSION);
    const statuses: string[] = [];
    transport.subscribe((event) => {
      if (event.type === 'status' && event.clientId === 'dup') {
        statuses.push(event.status);
      }
    });
    await transport.send({ conversationId: C1, clientId: asClientId('dup'), payload: { type: 'text', text: 'x' } });
    await vi.waitFor(() => {
      expect(statuses).toContain('sent');
    });
    statuses.length = 0;
    await transport.send({ conversationId: C1, clientId: asClientId('dup'), payload: { type: 'text', text: 'x' } });
    expect(statuses).toHaveLength(1);
    transport.disconnect();
  });

  it('mensagem que o servidor tem mas ficou fora do recent não fica em sending depois de reconectar', async () => {
    const backend = new MockBackend();
    const transport = new MockTransport({ backend, delays: { ...instant, sentMs: 40 } });
    const bruno = new MockTransport({ backend, delays: instant });
    const session = new ChatSession(transport, { createId: () => 'dup' });
    await session.start();
    await session.send(C1, 'antiga');
    transport.disconnect();
    await bruno.connect({ tenantId: ICS_TENANT_ID, userId: ICS_USERS.bruno });
    for (let index = 0; index < 55; index += 1) {
      await bruno.send({ conversationId: C1, clientId: asClientId(`b${String(index)}`), payload: { type: 'text', text: String(index) } });
    }
    await session.reconnect();
    await vi.waitFor(() => {
      const own = thread(session, C1).messages.find((message) => message.clientId === 'dup');
      expect(own?.status).toBeDefined();
      expect(own?.status).not.toBe('sending');
    });
    expect(thread(session, C1).messages.filter((message) => message.clientId === 'dup')).toHaveLength(1);
    session.stop();
    bruno.disconnect();
  });
});

describe('ChatSession multi-conversa: erro por conversa e lista à frente', () => {
  it('a falha de envio pertence à conversa; o erro de sessão não pertence a nenhuma', async () => {
    const { transport, session } = await scripted();
    session.selectConversation(C1);
    transport.failSend = true;
    await session.send(C1, 'oi');
    expect(session.getState().error).toMatch(/enviar/i);
    expect(session.getState().errorConversationId).toBe(C1);
    transport.failSend = false;
    const failed = thread(session, C1).messages[0];
    await session.retry(C1, failed?.id ?? '');
    expect(session.getState().error).toBeNull();
    expect(session.getState().errorConversationId).toBeNull();
    session.stop();
  });

  it('selectConversation(null) deixa nenhuma conversa ativa: a mensagem nova fica não lida', async () => {
    const { transport, session } = await scripted();
    session.selectConversation(C1);
    session.selectConversation(null);
    expect(session.getState().activeConversationId).toBeNull();
    transport.emit({ type: 'message', message: incoming('m-lista', C1) });
    expect(thread(session, C1).unread).toBe(1);
    session.selectConversation(C1);
    expect(thread(session, C1).unread).toBe(0);
    session.stop();
  });
});
