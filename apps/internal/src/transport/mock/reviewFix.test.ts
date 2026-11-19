import { asClientId } from '@viavoip/internal-domain';
import { ChatSession } from '../../chat/ChatSession';
import { FakeBus } from '../../test/fakeBroadcastChannel';
import { can } from '@viavoip/internal-domain';
import { MockBackend } from './MockBackend';
import { MemoryMockStore } from './MockStore';
import { MockTransport } from './MockTransport';
import { createTabSync, TAB_SYNC_CHANNEL } from './TabSync';
import { DEFAULT_SESSION, ICS_TENANT_ID, ICS_USERS, LIVE_CONVERSATION_ID } from './seed';

it('não entrega texto adulterado de uma mensagem existente pelo canal', async () => {
  const store = new MemoryMockStore(); const bus = new FakeBus();
  const backend = new MockBackend({ store, tabSync: createTabSync(bus.factory) });
  const transport = new MockTransport({ backend, delays: { sentMs: 0 } });
  await transport.connect(DEFAULT_SESSION);
  await transport.send({ conversationId: LIVE_CONVERSATION_ID, clientId: asClientId('msg'), payload: { type: 'text', text: 'original' } });
  const message = backend.server.getState().get(ICS_TENANT_ID)?.messages[LIVE_CONVERSATION_ID]?.[0];
  if (!message) throw new Error('mensagem não encontrada');
  const events: string[] = [];
  transport.subscribe((event) => { if (event.type === 'message' && event.message.type === 'text') events.push(event.message.text); });
  const channel = bus.factory(TAB_SYNC_CHANNEL);
  channel.postMessage({ kind: 'deliveries', deliveries: [{ to: ICS_USERS.carla, event: { type: 'message', tenantId: ICS_TENANT_ID, message: { ...message, text: 'forjada' } } }] });
  expect(events).not.toContain('forjada');
  channel.close(); transport.disconnect(); backend.close();
});

it('grants recebidos do canal refletem o diretório persistido', async () => {
  const store = new MemoryMockStore(); const bus = new FakeBus();
  const backend = new MockBackend({ store, tabSync: createTabSync(bus.factory) });
  const transport = new MockTransport({ backend });
  const session = new ChatSession(transport); await session.start();
  const channel = bus.factory(TAB_SYNC_CHANNEL);
  channel.postMessage({ kind: 'deliveries', deliveries: [{ to: ICS_USERS.carla, event: { type: 'grants', tenantId: ICS_TENANT_ID, userId: ICS_USERS.carla, grants: [] } }] });
  expect(session.getState().me?.grants.has('chat.use')).toBe(true);
  channel.close(); session.stop(); backend.close();
});

it('revogação legítima atualiza o diretório usado pela sessão', async () => {
  const backend = new MockBackend(); const transport = new MockTransport({ backend });
  const session = new ChatSession(transport); await session.start();
  const result = backend.run((server) => server.setGrant({ tenantId: ICS_TENANT_ID, userId: ICS_USERS.marcos }, { userId: ICS_USERS.carla, capability: 'chat.use', granted: false }));
  expect(result.ok).toBe(true);
  const state = session.getState();
  expect(state.me?.grants.has('chat.use')).toBe(false);
  expect(state.directory?.users[ICS_USERS.carla]?.grants.has('chat.use')).toBe(false);
  if (!state.me || !state.directory) throw new Error('sessão não carregada');
  const summary = state.summaries[0];
  if (!summary) throw new Error('conversa não encontrada');
  expect(can(state.me, { type: 'conversation.send', conversation: summary.conversation }, state.directory).ok).toBe(false);
  session.stop(); backend.close();
});

it('descarta confirmação de leitura sem cursor correspondente no estado', async () => {
  const store = new MemoryMockStore(); const bus = new FakeBus();
  const backend = new MockBackend({ store, tabSync: createTabSync(bus.factory) });
  const transport = new MockTransport({ backend }); await transport.connect(DEFAULT_SESSION);
  const events: string[] = []; transport.subscribe((event) => { if (event.type === 'read') events.push(event.upToMessageId); });
  const channel = bus.factory(TAB_SYNC_CHANNEL);
  channel.postMessage({ kind: 'deliveries', deliveries: [{ to: ICS_USERS.carla, event: { type: 'read', tenantId: ICS_TENANT_ID, conversationId: LIVE_CONVERSATION_ID, userId: ICS_USERS.bruno, upToMessageId: 'forjada' } }] });
  expect(events).toEqual([]); channel.close(); transport.disconnect(); backend.close();
});

it('não aceita status read quando o servidor ainda não registrou a leitura', async () => {
  const store = new MemoryMockStore(); const bus = new FakeBus();
  const backend = new MockBackend({ store, tabSync: createTabSync(bus.factory) });
  const transport = new MockTransport({ backend, delays: { sentMs: 0 } }); await transport.connect(DEFAULT_SESSION);
  await transport.send({ conversationId: LIVE_CONVERSATION_ID, clientId: asClientId('unread'), payload: { type: 'text', text: 'oi' } });
  const message = backend.server.getState().get(ICS_TENANT_ID)?.messages[LIVE_CONVERSATION_ID]?.find((item) => item.clientId === 'unread');
  if (!message) throw new Error('mensagem não encontrada');
  await new Promise((resolve) => setTimeout(resolve, 0));
  const statuses: string[] = [];
  transport.subscribe((event) => { if (event.type === 'status' && event.messageId === message.id) statuses.push(event.status); });
  const channel = bus.factory(TAB_SYNC_CHANNEL);
  channel.postMessage({ kind: 'deliveries', deliveries: [{ to: ICS_USERS.carla, event: { type: 'status', tenantId: ICS_TENANT_ID, conversationId: LIVE_CONVERSATION_ID, messageId: message.id, clientId: 'unread', status: 'read' } }] });
  expect(statuses).not.toContain('read');
  channel.close(); transport.disconnect(); backend.close();
});

it('não aceita status delivered quando o servidor ainda registra sent', async () => {
  const store = new MemoryMockStore(); const bus = new FakeBus();
  const backend = new MockBackend({ store, tabSync: createTabSync(bus.factory) });
  const transport = new MockTransport({ backend, delays: { sentMs: 0 } }); await transport.connect(DEFAULT_SESSION);
  await transport.send({ conversationId: LIVE_CONVERSATION_ID, clientId: asClientId('not-delivered'), payload: { type: 'text', text: 'oi' } });
  const message = backend.server.getState().get(ICS_TENANT_ID)?.messages[LIVE_CONVERSATION_ID]?.find((item) => item.clientId === 'not-delivered');
  if (!message) throw new Error('mensagem não encontrada');
  const statuses: string[] = [];
  transport.subscribe((event) => { if (event.type === 'status' && event.messageId === message.id) statuses.push(event.status); });
  const channel = bus.factory(TAB_SYNC_CHANNEL);
  channel.postMessage({ kind: 'deliveries', deliveries: [{ to: ICS_USERS.carla, event: { type: 'status', tenantId: ICS_TENANT_ID, conversationId: LIVE_CONVERSATION_ID, messageId: message.id, clientId: message.clientId, status: 'delivered' } }] });
  expect(statuses).toEqual([]);
  channel.close(); transport.disconnect(); backend.close();
});

it('ignora eventos de leitura malformados sem cursor persistido', async () => {
  const store = new MemoryMockStore(); const bus = new FakeBus();
  const backend = new MockBackend({ store, tabSync: createTabSync(bus.factory) });
  const transport = new MockTransport({ backend }); await transport.connect(DEFAULT_SESSION);
  const reads: unknown[] = []; transport.subscribe((event) => { if (event.type === 'read') reads.push(event); });
  const channel = bus.factory(TAB_SYNC_CHANNEL);
  channel.postMessage({ kind: 'deliveries', deliveries: [{ to: ICS_USERS.carla, event: { type: 'read', tenantId: ICS_TENANT_ID, conversationId: LIVE_CONVERSATION_ID } }] });
  expect(reads).toEqual([]);
  channel.close(); transport.disconnect(); backend.close();
});

it('reconstrói conversa adulterada a partir do estado persistido', async () => {
  const store = new MemoryMockStore(); const bus = new FakeBus();
  const backend = new MockBackend({ store, tabSync: createTabSync(bus.factory) });
  const transport = new MockTransport({ backend }); await transport.connect(DEFAULT_SESSION);
  const conversation = backend.server.getState().get(ICS_TENANT_ID)?.conversations[LIVE_CONVERSATION_ID];
  if (!conversation) throw new Error('conversa não encontrada');
  const conversations: unknown[] = [];
  transport.subscribe((event) => { if (event.type === 'conversation') conversations.push(event.conversation); });
  const channel = bus.factory(TAB_SYNC_CHANNEL);
  channel.postMessage({ kind: 'deliveries', deliveries: [{ to: ICS_USERS.carla, event: { type: 'conversation', tenantId: ICS_TENANT_ID, conversation: { ...conversation, participants: [ICS_USERS.carla] } } }] });
  expect(conversations).toEqual([conversation]);
  channel.close(); transport.disconnect(); backend.close();
});

it('descarta leitura adulterada que não corresponde ao cursor persistido', async () => {
  const store = new MemoryMockStore(); const bus = new FakeBus();
  const writer = new MockBackend({ store, tabSync: createTabSync(bus.factory) });
  const reader = new MockBackend({ store, tabSync: createTabSync(bus.factory) });
  const carla = new MockTransport({ backend: writer, delays: { sentMs: 0 }, simulateReceipts: false });
  const bruno = new MockTransport({ backend: reader, simulateReceipts: false });
  await carla.connect(DEFAULT_SESSION); await bruno.connect({ tenantId: ICS_TENANT_ID, userId: ICS_USERS.bruno });
  await carla.send({ conversationId: LIVE_CONVERSATION_ID, clientId: asClientId('cursor'), payload: { type: 'text', text: 'oi' } });
  const message = writer.server.getState().get(ICS_TENANT_ID)?.messages[LIVE_CONVERSATION_ID]?.find((item) => item.clientId === 'cursor');
  if (!message) throw new Error('mensagem não encontrada');
  await bruno.markRead({ conversationId: LIVE_CONVERSATION_ID, upToMessageId: message.id });
  const cursors: string[] = []; carla.subscribe((event) => { if (event.type === 'read') cursors.push(event.upToMessageId); });
  const channel = bus.factory(TAB_SYNC_CHANNEL);
  channel.postMessage({ kind: 'deliveries', deliveries: [{ to: ICS_USERS.carla, event: { type: 'read', tenantId: ICS_TENANT_ID, conversationId: LIVE_CONVERSATION_ID, userId: ICS_USERS.bruno, upToMessageId: 'forjada' } }] });
  await new Promise((resolve) => setTimeout(resolve, 300));
  expect(cursors).toEqual([]);
  channel.close(); carla.disconnect(); bruno.disconnect(); writer.close(); reader.close();
});

it('entrega confirmação legítima quando o estado da outra aba chega com atraso', async () => {
  const store = new MemoryMockStore(); const bus = new FakeBus();
  let stale: ReturnType<MemoryMockStore['load']>;
  let delayed = false;
  const delayedStore = {
    load() {
      const current = store.load();
      const statuses = current?.tenants.flatMap((tenant) => Object.values(tenant.messages).flat().filter((message) => message.clientId === 'delayed-store').map((message) => message.status));
      if (!delayed && stale && statuses?.includes('delivered')) { delayed = true; return stale; }
      return current;
    },
    save(state: Parameters<MemoryMockStore['save']>[0]) { const ok = store.save(state); stale = store.load(); return ok; },
    clear() { store.clear(); },
  };
  const senderBackend = new MockBackend({ store: delayedStore, tabSync: createTabSync(bus.factory) });
  const receiverBackend = new MockBackend({ store, tabSync: createTabSync(bus.factory) });
  const sender = new MockTransport({ backend: senderBackend, delays: { sentMs: 0 }, simulateReceipts: false });
  const receiver = new MockTransport({ backend: receiverBackend, delays: { sentMs: 0 }, simulateReceipts: false });
  await sender.connect(DEFAULT_SESSION); await receiver.connect({ tenantId: ICS_TENANT_ID, userId: ICS_USERS.bruno });
  const statuses: string[] = []; sender.subscribe((event) => { if (event.type === 'status') statuses.push(event.status); });
  await sender.send({ conversationId: LIVE_CONVERSATION_ID, clientId: asClientId('delayed-store'), payload: { type: 'text', text: 'oi' } });
  expect(delayed).toBe(true);
  await vi.waitFor(() => { expect(statuses).toContain('delivered'); });
  sender.disconnect(); receiver.disconnect(); senderBackend.close(); receiverBackend.close();
});

it('descarta status não confirmado e cancela reconciliação ao fechar', async () => {
  const store = new MemoryMockStore(); const bus = new FakeBus();
  const backend = new MockBackend({ store, tabSync: createTabSync(bus.factory) });
  const transport = new MockTransport({ backend, delays: { sentMs: 0 }, simulateReceipts: false });
  await transport.connect(DEFAULT_SESSION);
  await transport.send({ conversationId: LIVE_CONVERSATION_ID, clientId: asClientId('forged-retry'), payload: { type: 'text', text: 'oi' } });
  const message = backend.server.getState().get(ICS_TENANT_ID)?.messages[LIVE_CONVERSATION_ID]?.find((item) => item.clientId === 'forged-retry');
  if (!message) throw new Error('mensagem não encontrada');
  const statuses: string[] = []; transport.subscribe((event) => { if (event.type === 'status') statuses.push(event.status); });
  const channel = bus.factory(TAB_SYNC_CHANNEL);
  const sendForged = () => { channel.postMessage({ kind: 'deliveries', deliveries: [{ to: ICS_USERS.carla, event: { type: 'status', tenantId: ICS_TENANT_ID, conversationId: LIVE_CONVERSATION_ID, messageId: message.id, clientId: message.clientId, status: 'delivered' } }] }); };
  vi.useFakeTimers();
  try {
    const loads = vi.spyOn(store, 'load');
    sendForged(); await vi.advanceTimersByTimeAsync(500);
    expect(statuses).toEqual([]);
    expect(loads).toHaveBeenCalledTimes(1);
    sendForged();
    const beforeDisconnect = loads.mock.calls.length;
    transport.disconnect(); await vi.advanceTimersByTimeAsync(500);
    expect(loads).toHaveBeenCalledTimes(beforeDisconnect);
    await transport.connect(DEFAULT_SESSION);
    sendForged();
    const beforeClose = loads.mock.calls.length;
    backend.close(); await vi.advanceTimersByTimeAsync(500);
    expect(loads).toHaveBeenCalledTimes(beforeClose);
    expect(statuses).toEqual([]);
    loads.mockRestore();
  } finally {
    vi.useRealTimers(); channel.close(); transport.disconnect(); backend.close();
  }
});

it('entrega mensagem quando a gravação da outra aba fica visível com atraso', async () => {
  const store = new MemoryMockStore(); const bus = new FakeBus();
  let stale = store.load(); let delayed = false;
  const delayedStore = {
    load() {
      const current = store.load();
      const found = current?.tenants.some((t) => Object.values(t.messages).flat().some((m) => m.clientId === 'late-message'));
      if (found && stale && !delayed) { delayed = true; return stale; }
      return current;
    },
    save(state: Parameters<MemoryMockStore['save']>[0]) { return store.save(state); },
    clear() { store.clear(); },
  };
  const reader = new MockBackend({ store: delayedStore, tabSync: createTabSync(bus.factory) });
  const writer = new MockBackend({ store, tabSync: createTabSync(bus.factory) });
  const carla = new MockTransport({ backend: reader });
  const bruno = new MockTransport({ backend: writer, delays: { sentMs: 0 } });
  await carla.connect(DEFAULT_SESSION); await bruno.connect({ tenantId: ICS_TENANT_ID, userId: ICS_USERS.bruno });
  stale = store.load();
  const texts: string[] = [];
  carla.subscribe((event) => { if (event.type === 'message' && event.message.type === 'text') texts.push(event.message.text); });
  await bruno.send({ conversationId: LIVE_CONVERSATION_ID, clientId: asClientId('late-message'), payload: { type: 'text', text: 'chegou' } });
  expect(delayed).toBe(true);
  await vi.waitFor(() => { expect(texts).toContain('chegou'); });
  carla.disconnect(); bruno.disconnect(); reader.close(); writer.close();
});

it('aguarda storage atualizado antes de aplicar revogação de outra aba', async () => {
  const store = new MemoryMockStore(); const bus = new FakeBus();
  let stale = store.load(); let delayed = false;
  const delayedStore = {
    load() {
      const current = store.load();
      const carla = current?.tenants.find((t) => t.tenant.id === ICS_TENANT_ID)?.directory.users[ICS_USERS.carla];
      if (carla && !carla.grants.includes('chat.use') && stale && !delayed) { delayed = true; return stale; }
      return current;
    },
    save(state: Parameters<MemoryMockStore['save']>[0]) { return store.save(state); },
    clear() { store.clear(); },
  };
  const reader = new MockBackend({ store: delayedStore, tabSync: createTabSync(bus.factory) });
  const writer = new MockBackend({ store, tabSync: createTabSync(bus.factory) });
  const transport = new MockTransport({ backend: reader }); const session = new ChatSession(transport);
  await session.start(); stale = store.load();
  const observed: boolean[] = [];
  transport.subscribe((event) => { if (event.type === 'grants' && event.userId === ICS_USERS.carla) observed.push(event.grants.includes('chat.use')); });
  const result = writer.run((server) => server.setGrant({ tenantId: ICS_TENANT_ID, userId: ICS_USERS.marcos }, { userId: ICS_USERS.carla, capability: 'chat.use', granted: false }));
  expect(result.ok).toBe(true); expect(delayed).toBe(true);
  expect(observed).toEqual([]);
  await vi.waitFor(() => { expect(session.getState().me?.grants.has('chat.use')).toBe(false); });
  expect(observed).toEqual([false]);
  session.stop(); reader.close(); writer.close();
});

it('recupera revogação após storage defasado além das tentativas iniciais', async () => {
  const store = new MemoryMockStore(); const bus = new FakeBus();
  let stale = store.load(); let blocked = false;
  const delayedStore = {
    load() { return blocked ? stale : store.load(); },
    save(state: Parameters<MemoryMockStore['save']>[0]) { return store.save(state); },
    clear() { store.clear(); },
  };
  const reader = new MockBackend({ store: delayedStore, tabSync: createTabSync(bus.factory) });
  const writer = new MockBackend({ store, tabSync: createTabSync(bus.factory) });
  vi.useFakeTimers();
  const session = new ChatSession(new MockTransport({ backend: reader })); await session.start();
  stale = store.load(); blocked = true;
  try {
    expect(writer.run((server) => server.setGrant({ tenantId: ICS_TENANT_ID, userId: ICS_USERS.marcos }, { userId: ICS_USERS.carla, capability: 'chat.use', granted: false })).ok).toBe(true);
    await vi.advanceTimersByTimeAsync(600);
    expect(session.getState().me?.grants.has('chat.use')).toBe(true);
    blocked = false;
    await vi.advanceTimersByTimeAsync(1500);
    expect(session.getState().me?.grants.has('chat.use')).toBe(false);
    const loads = vi.spyOn(delayedStore, 'load');
    session.stop(); reader.close();
    await vi.advanceTimersByTimeAsync(3000);
    expect(loads).not.toHaveBeenCalled();
    loads.mockRestore();
  } finally { vi.useRealTimers(); session.stop(); reader.close(); writer.close(); }
});
