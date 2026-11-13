import { FakeBus } from '../../test/fakeBroadcastChannel';
import type { ChatEvent, ConnectRequest } from '../ChatTransport';
import { MockBackend } from './MockBackend';
import { MemoryMockStore } from './MockStore';
import { MockTransport } from './MockTransport';
import { createTabSync, TAB_SYNC_CHANNEL } from './TabSync';
import { DEFAULT_SESSION, ICS_TENANT_ID, ICS_USERS, LIVE_CONVERSATION_ID } from './seed';

const instant = { connectMs: 0, sentMs: 0, deliveredMs: 0, readMs: 0 };
const BRUNO: ConnectRequest = { tenantId: ICS_TENANT_ID, userId: ICS_USERS.bruno };

/** Duas "abas" do mesmo perfil: backends separados sobre o mesmo store e o mesmo canal. */
function twoTabs() {
  const store = new MemoryMockStore();
  const bus = new FakeBus();
  const tab1 = new MockBackend({ store, tabSync: createTabSync(bus.factory) });
  const tab2 = new MockBackend({ store, tabSync: createTabSync(bus.factory) });
  return { store, tab1, tab2 };
}

function collect(transport: MockTransport): ChatEvent[] {
  const events: ChatEvent[] = [];
  transport.subscribe((event) => {
    events.push(event);
  });
  return events;
}

describe('MockBackend entre abas', () => {
  it('a aba que escreve persiste e a outra entrega ao usuário conectado nela, marcando "entregue"', async () => {
    const { tab1, tab2 } = twoTabs();
    const carla = new MockTransport({ delays: instant, backend: tab1, simulateReceipts: false });
    const bruno = new MockTransport({ delays: instant, backend: tab2, simulateReceipts: false });
    const carlaEvents = collect(carla);
    const brunoEvents = collect(bruno);
    await carla.connect(DEFAULT_SESSION);
    await bruno.connect(BRUNO);
    carlaEvents.length = 0;
    brunoEvents.length = 0;

    await carla.send({ conversationId: LIVE_CONVERSATION_ID, clientId: 'c-1', payload: { type: 'text', text: 'oi da aba 1' } });

    const received = brunoEvents.find((event) => event.type === 'message');
    expect(received?.type === 'message' && received.message).toMatchObject({ text: 'oi da aba 1', status: 'sent' });
    // A aba 2 marcou "entregue" (Bruno está lá) e avisou a aba 1 pelo canal.
    await vi.waitFor(() => {
      expect(carlaEvents.some((event) => event.type === 'status' && event.status === 'delivered')).toBe(true);
    });
  });

  it('markRead na aba 2 chega como "lida" na aba 1', async () => {
    const { tab1, tab2 } = twoTabs();
    const carla = new MockTransport({ delays: instant, backend: tab1, simulateReceipts: false });
    const bruno = new MockTransport({ delays: instant, backend: tab2, simulateReceipts: false });
    const carlaEvents = collect(carla);
    const brunoEvents = collect(bruno);
    await carla.connect(DEFAULT_SESSION);
    await bruno.connect(BRUNO);
    await carla.send({ conversationId: LIVE_CONVERSATION_ID, clientId: 'c-1', payload: { type: 'text', text: 'oi' } });
    const echo = brunoEvents.find((event) => event.type === 'message');
    if (echo?.type !== 'message') {
      throw new Error('esperava a mensagem na aba 2');
    }
    carlaEvents.length = 0;
    await bruno.markRead({ conversationId: LIVE_CONVERSATION_ID, upToMessageId: echo.message.id });
    expect(carlaEvents.some((event) => event.type === 'status' && event.status === 'read')).toBe(true);
    expect(carlaEvents.some((event) => event.type === 'read')).toBe(true);
  });

  it('uma aba nova lê o estado que a outra gravou (store compartilhado)', async () => {
    const { store, tab1 } = twoTabs();
    const carla = new MockTransport({ delays: instant, backend: tab1, simulateReceipts: false });
    await carla.connect(DEFAULT_SESSION);
    await carla.send({ conversationId: LIVE_CONVERSATION_ID, clientId: 'c-1', payload: { type: 'text', text: 'persistida' } });
    const tab3 = new MockBackend({ store, tabSync: createTabSync(new FakeBus().factory) });
    const bruno = new MockTransport({ delays: instant, backend: tab3, simulateReceipts: false });
    const bootstrap = await bruno.connect(BRUNO);
    expect(bootstrap.recent[LIVE_CONVERSATION_ID]?.map((message) => message.type === 'text' && message.text)).toEqual([
      'persistida',
    ]);
  });

  it('openDirect numa aba aparece como evento conversation na outra', async () => {
    const { tab1, tab2 } = twoTabs();
    const ana = new MockTransport({ delays: instant, backend: tab1, simulateReceipts: false });
    const diego = new MockTransport({ delays: instant, backend: tab2, simulateReceipts: false });
    const diegoEvents = collect(diego);
    await ana.connect({ tenantId: ICS_TENANT_ID, userId: ICS_USERS.ana });
    await diego.connect({ tenantId: ICS_TENANT_ID, userId: ICS_USERS.diego });
    diegoEvents.length = 0;
    const conversation = await ana.openDirect({ with: ICS_USERS.diego });
    expect(diegoEvents).toEqual([{ type: 'conversation', tenantId: ICS_TENANT_ID, conversation }]);
  });

  it('não entrega a quem não está conectado nem a outro tenant', async () => {
    const { tab1, tab2 } = twoTabs();
    const carla = new MockTransport({ delays: instant, backend: tab1, simulateReceipts: false });
    const paula = new MockTransport({ delays: instant, backend: tab2, simulateReceipts: false });
    const paulaEvents = collect(paula);
    await carla.connect(DEFAULT_SESSION);
    await paula.connect({ tenantId: 'bv' as typeof ICS_TENANT_ID, userId: 'bv-paula' as typeof ICS_USERS.carla });
    paulaEvents.length = 0;
    await carla.send({ conversationId: LIVE_CONVERSATION_ID, clientId: 'c-1', payload: { type: 'text', text: 'oi' } });
    expect(paulaEvents).toEqual([]);
  });

  it('sem store compartilhado, um backend novo começa da seed (reset)', () => {
    const backend = new MockBackend();
    expect(backend.query((server) => server.getState().size)).toBe(2);
  });

  it('leave desregistra a presença: depois disso o usuário não conta como conectado', async () => {
    const backend = new MockBackend();
    const bruno = new MockTransport({ delays: instant, backend });
    await bruno.connect(BRUNO);
    expect(backend.server.isOnline(ICS_TENANT_ID, ICS_USERS.bruno)).toBe(true);
    await bruno.connect(BRUNO);
    bruno.disconnect();
    expect(backend.server.isOnline(ICS_TENANT_ID, ICS_USERS.bruno)).toBe(false);
  });
});

describe('MockBackend: entrada não confiável pelo canal', () => {
  const brunoOnline = async () => {
    const store = new MemoryMockStore();
    const bus = new FakeBus();
    const backend = new MockBackend({ store, tabSync: createTabSync(bus.factory) });
    const bruno = new MockTransport({ delays: instant, backend });
    const events = collect(bruno);
    await bruno.connect(BRUNO);
    events.length = 0;
    const raw = bus.factory(TAB_SYNC_CHANNEL);
    return { events, raw, backend };
  };
  const real = (type: string, extra: Record<string, unknown> = {}) => ({
    to: ICS_USERS.bruno,
    event: { type, tenantId: ICS_TENANT_ID, conversationId: LIVE_CONVERSATION_ID, userId: ICS_USERS.carla, isTyping: true, ...extra },
  });
  const post = (raw: { postMessage(m: unknown): void }, ...deliveries: unknown[]) => {
    raw.postMessage({ kind: 'deliveries', deliveries });
  };

  it('entrega o que é coerente (controle)', async () => {
    const { events, raw } = await brunoOnline();
    post(raw, real('typing'));
    expect(events).toHaveLength(1);
  });

  it('descarta evento forjado: tenant inexistente, usuário de outro tenant, não participante, incoerente', async () => {
    const { events, raw } = await brunoOnline();
    const bvConv = 'dm:bv:bv-otavio:bv-paula';
    post(
      raw,
      // tenant inexistente
      real('typing', { tenantId: 'fantasma' }),
      // destinatário que não existe no tenant do evento
      { to: 'bv-paula', event: { type: 'typing', tenantId: ICS_TENANT_ID, conversationId: LIVE_CONVERSATION_ID, userId: ICS_USERS.carla, isTyping: true } },
      // conversa de outro tenant
      real('typing', { conversationId: bvConv }),
      // conversa inexistente
      real('typing', { conversationId: 'dm:ics:nada' }),
      // destinatário não participa da conversa
      { to: ICS_USERS.ana, event: real('typing').event },
      // mensagem com tenantId incoerente com o evento
      real('message', { message: { id: 'x', tenantId: 'bv', conversationId: LIVE_CONVERSATION_ID, authorId: ICS_USERS.carla } }),
      // mensagem que o servidor não conhece
      real('message', { message: { id: 'forjada', tenantId: ICS_TENANT_ID, conversationId: LIVE_CONVERSATION_ID, authorId: ICS_USERS.carla } }),
      // mensagem e conversa ausentes no evento
      real('message', { message: undefined }),
      real('conversation', { conversation: null }),
      // conversa nova com tenantId incoerente
      real('conversation', { conversation: { id: LIVE_CONVERSATION_ID, tenantId: 'bv' } }),
      // grants de usuário que não existe
      real('grants', { userId: 'fantasma', grants: [] }),
      // tipo desconhecido e lixo
      real('desconhecido'),
      'lixo',
      null,
    );
    expect(events).toEqual([]);
  });
});

describe('MockBackend: falha de gravação', () => {
  it('depois que o storage falha, opera só em memória e não relê o storage velho', async () => {
    const store = new MemoryMockStore();
    let fail = false;
    const original = store.save.bind(store);
    store.save = (state) => (fail ? false : original(state));
    const backend = new MockBackend({ store });
    const carla = new MockTransport({ delays: instant, backend });
    await carla.connect(DEFAULT_SESSION);
    fail = true;
    await carla.send({ conversationId: LIVE_CONVERSATION_ID, clientId: 'c-1', payload: { type: 'text', text: 'só na memória' } });
    fail = false;
    await carla.send({ conversationId: LIVE_CONVERSATION_ID, clientId: 'c-2', payload: { type: 'text', text: 'segue em memória' } });
    const texts = backend.server
      .getState()
      .get(ICS_TENANT_ID)
      ?.messages[LIVE_CONVERSATION_ID]?.map((m) => m.type === 'text' && m.text);
    expect(texts).toEqual(['só na memória', 'segue em memória']);
    expect(store.load()?.tenants).toBeDefined();
    expect(JSON.stringify(store.load())).not.toContain('só na memória');
  });
});
