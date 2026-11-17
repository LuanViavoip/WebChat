import { Lab, type Probe } from '../../test/adminProbe';
import { FakeBus } from '../../test/fakeBroadcastChannel';
import type { UserId } from '@viavoip/internal-domain';
import type { ChatEvent, ConnectRequest } from '../ChatTransport';
import { MockBackend } from './MockBackend';
import type { MockStore } from './MockStore';
import { MockTransport } from './MockTransport';
import { BV_TENANT_ID, BV_USERS, ICS_ILHAS, ICS_TENANT_ID, ICS_USERS, LIVE_CONVERSATION_ID } from './seed';
import { fromPersisted, PERSIST_VERSION, type PersistedState } from './state';

const as = (tenantId: typeof ICS_TENANT_ID, userId: UserId): ConnectRequest => ({ tenantId, userId });
const MARCOS = as(ICS_TENANT_ID, ICS_USERS.marcos);
const ANA = as(ICS_TENANT_ID, ICS_USERS.ana);
const BRUNO = as(ICS_TENANT_ID, ICS_USERS.bruno);
const HELENA = as(BV_TENANT_ID, BV_USERS.helena);

let lab: Lab;
let bus: FakeBus;
beforeEach(() => {
  vi.useFakeTimers();
  lab = new Lab();
  bus = new FakeBus();
});
afterEach(() => {
  lab.close();
  vi.useRealTimers();
});

const ended = (probe: Probe): ChatEvent[] => probe.events.filter((event) => event.type === 'session-ended');
const ENDED = { type: 'session-ended', tenantId: ICS_TENANT_ID, reason: 'deactivated' };

/** Admin e agente em abas separadas sobre o MESMO storage; a entrega entre abas fica retida. */
async function scenario(agent: ConnectRequest = ANA) {
  const adminTab = lab.tab(bus);
  const agentTab = lab.tab(bus);
  const admin = await lab.join(adminTab, MARCOS);
  const victim = await lab.join(agentTab, agent);
  bus.held = true;
  return { adminTab, agentTab, admin, victim };
}

async function bounce(admin: Probe, userId: UserId): Promise<void> {
  await admin.transport.deactivateUser({ userId });
  await admin.transport.reactivateUser({ userId });
}

async function rejected(promise: Promise<unknown>): Promise<void> {
  await expect(promise).rejects.toThrow();
}

describe('época de sessão: desativar encerra TODAS as sessões abertas, reativar só permite login novo', () => {
  it('(a) entrega entre abas atrasada: desativa e reativa, entrega os eventos, e a sessão antiga cai', async () => {
    const { agentTab, admin, victim } = await scenario();
    await bounce(admin, ICS_USERS.ana);
    // Nada entregue ainda: a aba do agente ainda não sabe de nada.
    expect(victim.transport.getStatus()).toBe('connected');
    bus.flush();
    expect(ended(victim)).toEqual([ENDED]);
    expect(victim.transport.getStatus()).toBe('disconnected');
    await rejected(victim.transport.openDirect({ with: ICS_USERS.bruno }));
    await rejected(victim.transport.send({ conversationId: LIVE_CONVERSATION_ID, clientId: 'c', payload: { type: 'text', text: 'oi' } }));
    await rejected(victim.transport.setGrant({ userId: ICS_USERS.bruno, capability: 'chat.use', granted: false }));
    // O servidor também recusa quem ainda carrega a época antiga, mesmo com a conta ativa.
    const stale = { ...ANA, epoch: 0 };
    expect(agentTab.server.epochOf(ICS_TENANT_ID, ICS_USERS.ana)).toBe(1);
    expect(agentTab.server.send(stale, { conversationId: LIVE_CONVERSATION_ID, clientId: 'c', payload: { type: 'text', text: 'oi' } }).result.ok).toBe(false);
    expect(agentTab.server.openDirect(stale, { with: ICS_USERS.bruno }).result.ok).toBe(false);
    expect(agentTab.server.setGrant(stale, { userId: ICS_USERS.bruno, capability: 'chat.use', granted: false }).result.ok).toBe(false);
  });

  it('(b) sem nenhuma entrega entre abas: só o polling de 500 ms derruba a sessão', async () => {
    const { admin, victim } = await scenario();
    await bounce(admin, ICS_USERS.ana);
    expect(victim.transport.getStatus()).toBe('connected');
    vi.advanceTimersByTime(600);
    expect(ended(victim)).toEqual([ENDED]);
    expect(victim.transport.getStatus()).toBe('disconnected');
    await rejected(victim.transport.openDirect({ with: ICS_USERS.bruno }));
  });

  it.each([
    ['send', (p: Probe) => p.transport.send({ conversationId: LIVE_CONVERSATION_ID, clientId: 'c', payload: { type: 'text', text: 'oi' } })],
    ['openDirect', (p: Probe) => p.transport.openDirect({ with: ICS_USERS.bruno })],
    ['upload', (p: Probe) => p.transport.upload({ conversationId: LIVE_CONVERSATION_ID, clientId: 'upload-obsoleto', file: new Blob(['imagem'], { type: 'image/png' }), fileName: 'imagem.png', mimeType: 'image/png', signal: new AbortController().signal, onProgress: () => undefined })],
    ['markRead', (p: Probe) => p.transport.markRead({ conversationId: LIVE_CONVERSATION_ID, upToMessageId: 'x' })],
    ['grantLog', (p: Probe) => p.transport.grantLog()],
    ['setGrant', (p: Probe) => p.transport.setGrant({ userId: ICS_USERS.bruno, capability: 'chat.use', granted: false })],
    ['registerAgent', (p: Probe) => p.transport.registerAgent({ name: 'X', ilhaIds: [ICS_ILHAS.norte]})],
  ])('(c) %s chamado ANTES de qualquer reconcile: a própria chamada detecta a época e a sessão cai', async (_name, call) => {
    const adminTab = lab.tab(bus);
    const carlaTab = lab.tab(bus);
    const admin = await lab.join(adminTab, MARCOS);
    const carla = await lab.join(carlaTab, as(ICS_TENANT_ID, ICS_USERS.carla));
    bus.held = true;
    await bounce(admin, ICS_USERS.carla);
    // Sem entrega e sem polling: a aba da Carla ainda não processou nada.
    expect(carla.transport.getStatus()).toBe('connected');
    await rejected(call(carla));
    expect(ended(carla)).toEqual([ENDED]);
    expect(carla.transport.getStatus()).toBe('disconnected');
  });

  it('um upload em andamento é abortado quando a sessão antiga é encerrada', async () => {
    const { admin, victim } = await scenario();
    const conversationId = (await victim.transport.openDirect({ with: ICS_USERS.bruno })).id;
    const progress = vi.fn();
    const uploading = victim.transport.upload({
      conversationId,
      clientId: 'upload-em-andamento',
      file: new Blob(['imagem'], { type: 'image/png' }),
      fileName: 'imagem.png',
      mimeType: 'image/png',
      signal: new AbortController().signal,
      onProgress: progress,
    });
    const outcome = uploading.then(() => 'resolved', () => 'rejected');
    await vi.advanceTimersByTimeAsync(150);
    expect(progress).toHaveBeenCalled();
    await bounce(admin, ICS_USERS.ana);
    bus.flush();
    await vi.advanceTimersByTimeAsync(1000);
    expect(await outcome).toBe('rejected');
    expect(victim.transport.getStatus()).toBe('disconnected');
  });

  it('(d) reconectar depois da reativação funciona, com o histórico, e o evento atrasado não derruba o login novo', async () => {
    const { agentTab, admin, victim } = await scenario();
    const conversation = (await victim.transport.openDirect({ with: ICS_USERS.bruno })).id;
    await victim.transport.send({ conversationId: conversation, clientId: 'antes', payload: { type: 'text', text: 'mensagem de antes' } });
    await bounce(admin, ICS_USERS.ana);
    const again = new MockTransport({ backend: agentTab, delays: { connectMs: 0 } });
    const bootstrap = await again.connect(ANA);
    expect(again.getStatus()).toBe('connected');
    expect(bootstrap.recent[conversation]?.some((message) => message.type === 'text' && message.text === 'mensagem de antes')).toBe(true);
    bus.flush();
    vi.advanceTimersByTime(1000);
    expect(again.getStatus()).toBe('connected');
    expect(ended(victim)).toEqual([ENDED]);
    await again.openDirect({ with: ICS_USERS.camila });
    again.disconnect();
  });

  it('(e) desativar/reativar o usuário A não derruba B, nem outra empresa, e a época não vaza', async () => {
    const adminTab = lab.tab(bus);
    const otherTab = lab.tab(bus);
    const admin = await lab.join(adminTab, MARCOS);
    const ana = await lab.join(otherTab, ANA);
    const bruno = await lab.join(otherTab, BRUNO);
    const helena = await lab.join(otherTab, HELENA);
    bus.held = true;
    await bounce(admin, ICS_USERS.ana);
    bus.flush();
    vi.advanceTimersByTime(1000);
    expect(ended(ana)).toEqual([ENDED]);
    for (const probe of [bruno, helena]) {
      expect(probe.transport.getStatus()).toBe('connected');
      expect(ended(probe)).toEqual([]);
    }
    await bruno.transport.openDirect({ with: ICS_USERS.camila });
    await helena.transport.openDirect({ with: BV_USERS.paula });
    const state = otherTab.server.getState();
    expect(state.get(ICS_TENANT_ID)?.sessionEpochs).toEqual({ [ICS_USERS.ana]: 1 });
    expect(state.get(BV_TENANT_ID)?.sessionEpochs).toEqual({});
    expect(otherTab.server.epochOf(ICS_TENANT_ID, ICS_USERS.bruno)).toBe(0);
    // A época nunca vai ao cliente: nem no Bootstrap, nem no diretório, nem na tela de login.
    expect(JSON.stringify(otherTab.server.bootstrap(BRUNO))).not.toMatch(/epoch/i);
    expect(JSON.stringify(otherTab.server.loginGroups())).not.toMatch(/epoch/i);
    expect(JSON.stringify(admin.events.concat(bruno.events))).not.toMatch(/epoch/i);
  });

  it('a época só sobe em desativação aceita (reativar e repetir não contam) e acumula', async () => {
    const backend = lab.tab();
    const admin = await lab.join(backend, MARCOS);
    expect(backend.server.epochOf(ICS_TENANT_ID, ICS_USERS.ana)).toBe(0);
    await admin.transport.deactivateUser({ userId: ICS_USERS.ana });
    await admin.transport.deactivateUser({ userId: ICS_USERS.ana });
    expect(backend.server.epochOf(ICS_TENANT_ID, ICS_USERS.ana)).toBe(1);
    await admin.transport.reactivateUser({ userId: ICS_USERS.ana });
    expect(backend.server.epochOf(ICS_TENANT_ID, ICS_USERS.ana)).toBe(1);
    await admin.transport.deactivateUser({ userId: ICS_USERS.ana });
    expect(backend.server.epochOf(ICS_TENANT_ID, ICS_USERS.ana)).toBe(2);
    // Recusada (agente tentando desativar) não sobe.
    const bruno = await lab.join(backend, BRUNO);
    await rejected(bruno.transport.deactivateUser({ userId: ICS_USERS.camila }));
    expect(backend.server.epochOf(ICS_TENANT_ID, ICS_USERS.camila)).toBe(0);
  });
});

function rawStore(raw: unknown): MockStore {
  const json = JSON.stringify(raw);
  return { load: () => JSON.parse(json) as PersistedState, save: () => true, clear: () => undefined };
}

describe('época de sessão: persistência e migração', () => {
  const seeded = () => lab.tab().server.toPersisted();
  const withTenant = (change: (tenant: Record<string, unknown>) => Record<string, unknown>) => {
    const persisted = seeded();
    return { ...persisted, tenants: persisted.tenants.map((tenant) => (tenant.tenant.id === ICS_TENANT_ID ? change({ ...tenant }) : tenant)) };
  };
  const omitEpochs = (tenant: Record<string, unknown>) => Object.fromEntries(Object.entries(tenant).filter(([key]) => key !== 'sessionEpochs'));

  it('(f) estado v3 (sem épocas) carrega com época 0 e sem perder dados; a próxima gravação sai na versão atual', async () => {
    const legacy = { ...seeded(), version: 3, tenants: seeded().tenants.map(omitEpochs) };
    const backend = new MockBackend({ store: rawStore(legacy), now: () => '2026-11-16T12:00:00.000Z' });
    const ics = backend.server.getState().get(ICS_TENANT_ID);
    expect(Object.keys(ics?.directory.users ?? {})).toHaveLength(9);
    expect(Object.values(ics?.messages ?? {}).flat().length).toBeGreaterThan(0);
    expect(backend.server.epochOf(ICS_TENANT_ID, ICS_USERS.ana)).toBe(0);
    const marcos = new MockTransport({ backend, delays: { connectMs: 0 } });
    await marcos.connect(MARCOS);
    await marcos.deactivateUser({ userId: ICS_USERS.ana });
    expect(backend.server.toPersisted().version).toBe(PERSIST_VERSION);
    expect(backend.server.epochOf(ICS_TENANT_ID, ICS_USERS.ana)).toBe(1);
    marcos.disconnect();
    backend.close();
  });

  it('(f) estado da versão atual sem o campo também carrega com época 0', () => {
    const state = fromPersisted({ ...seeded(), tenants: seeded().tenants.map(omitEpochs) });
    expect(state?.get(ICS_TENANT_ID)?.sessionEpochs).toEqual({});
    expect(state?.get(ICS_TENANT_ID)?.directory.users[ICS_USERS.ana]?.name).toBeDefined();
  });

  it('(f) épocas gravadas voltam do storage', () => {
    const state = fromPersisted(withTenant((tenant) => ({ ...tenant, sessionEpochs: { [ICS_USERS.ana]: 3 } })));
    expect(state?.get(ICS_TENANT_ID)?.sessionEpochs).toEqual({ [ICS_USERS.ana]: 3 });
  });

  it.each([
    ['negativa', { [ICS_USERS.ana]: -1 }],
    ['fracionária', { [ICS_USERS.ana]: 1.5 }],
    ['texto', { [ICS_USERS.ana]: 'x' }],
    ['de usuário inexistente', { fantasma: 1 }],
    ['de usuário de outra empresa', { [BV_USERS.helena]: 1 }],
  ])('(f) época %s no storage é estado incoerente (recria a seed)', (_name, epochs) => {
    expect(fromPersisted(withTenant((tenant) => ({ ...tenant, sessionEpochs: epochs })))).toBeUndefined();
  });

  it('sessionEpochs que não é objeto é incoerente', () => {
    expect(fromPersisted(withTenant((tenant) => ({ ...tenant, sessionEpochs: [1] })))).toBeUndefined();
    expect(fromPersisted(withTenant((tenant) => ({ ...tenant, sessionEpochs: 'x' })))).toBeUndefined();
  });
});
