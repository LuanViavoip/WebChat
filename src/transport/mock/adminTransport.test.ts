import { FakeBus } from '../../test/fakeBroadcastChannel';
import { Lab, typesOf, type Probe } from '../../test/adminProbe';
import { asConversationId } from '../../domain/conversation';
import type { IlhaId, UserId } from '../../domain/identity';
import { ForbiddenError } from '../errors';
import { MockTransport } from './MockTransport';
import type { ChatEvent } from '../ChatTransport';
import { MockBackend } from './MockBackend';
import type { MockStore } from './MockStore';
import type { PersistedState } from './state';
import { BV_ILHAS, BV_TENANT_ID, BV_USERS, ICS_ILHAS, ICS_TENANT_ID, ICS_USERS } from './seed';

const as = (tenantId: typeof ICS_TENANT_ID, userId: UserId) => ({ tenantId, userId });
const MARCOS = as(ICS_TENANT_ID, ICS_USERS.marcos);
const CARLA = as(ICS_TENANT_ID, ICS_USERS.carla);
const RAFAEL = as(ICS_TENANT_ID, ICS_USERS.rafael);
const ANA = as(ICS_TENANT_ID, ICS_USERS.ana);
const HELENA = as(BV_TENANT_ID, BV_USERS.helena);
const PAULA = as(BV_TENANT_ID, BV_USERS.paula);
const OTAVIO = as(BV_TENANT_ID, BV_USERS.otavio);

/** Um storage que devolve exatamente o que se pôs (JSON cru), para simular estado antigo ou adulterado. */
function rawStore(raw: unknown): MockStore {
  const json = JSON.stringify(raw);
  return { load: () => JSON.parse(json) as PersistedState, save: () => true, clear: () => undefined };
}

let lab: Lab;
beforeEach(() => {
  lab = new Lab();
});
afterEach(() => {
  lab.close();
  vi.useRealTimers();
});

function ofType<T extends ChatEvent['type']>(probe: Probe, type: T): Array<Extract<ChatEvent, { type: T }>> {
  return probe.events.filter((event): event is Extract<ChatEvent, { type: T }> => event.type === type);
}

async function rejection(promise: Promise<unknown>): Promise<ForbiddenError> {
  const outcome = await promise.then(
    () => undefined,
    (error: unknown) => error,
  );
  expect(outcome).toBeInstanceOf(ForbiddenError);
  if (!(outcome instanceof ForbiddenError)) {
    throw new Error('esperava ForbiddenError');
  }
  return outcome;
}

describe('administração no transporte: isolamento entre empresas', () => {
  it('toda operação aceita na empresa A não gera NENHUM evento nem mudança visível em B', async () => {
    const backend = lab.tab();
    const marcos = await lab.join(backend, MARCOS);
    const carla = await lab.join(backend, CARLA);
    const helena = await lab.join(backend, HELENA);
    const paula = await lab.join(backend, PAULA);
    const bvBefore = JSON.stringify(backend.server.bootstrap(HELENA));
    const bvPaulaBefore = JSON.stringify(backend.server.bootstrap(PAULA));
    const bvLoginBefore = JSON.stringify(backend.server.loginGroups().filter((group) => group.tenant.id === BV_TENANT_ID));

    const t = marcos.transport;
    const supervisor = await t.registerSupervisor({ name: 'Nova Supervisora', ilhaIds: [] });
    const agent = await t.registerAgent({ name: 'Novo Agente', ilhaId: ICS_ILHAS.sul });
    const ilha = await t.createIlha({ name: 'Plantão', supervisorId: supervisor.id });
    await t.renameIlha({ ilhaId: ilha.id, name: 'Plantão Noturno' });
    await t.assignIlhaSupervisor({ ilhaId: ilha.id, supervisorId: ICS_USERS.rafael });
    await t.moveAgent({ userId: agent.id, ilhaId: ICS_ILHAS.exames });
    await t.setGrant({ userId: ICS_USERS.ana, capability: 'chat.use', granted: false });
    await t.setGrant({ userId: ICS_USERS.ana, capability: 'chat.use', granted: true });
    await t.deactivateUser({ userId: ICS_USERS.bruno });
    await t.reactivateUser({ userId: ICS_USERS.bruno });

    expect(helena.events).toEqual([]);
    expect(paula.events).toEqual([]);
    expect(JSON.stringify(backend.server.bootstrap(HELENA))).toBe(bvBefore);
    expect(JSON.stringify(backend.server.bootstrap(PAULA))).toBe(bvPaulaBefore);
    expect(JSON.stringify(backend.server.loginGroups().filter((group) => group.tenant.id === BV_TENANT_ID))).toBe(bvLoginBefore);
    expect(await helena.transport.grantLog()).toEqual([]);
    // O mesmo vale para o log: nada do ICS aparece para o BV, e o ICS tem as suas entradas.
    expect((await t.grantLog()).length).toBe(2);
    // Dentro do ICS o evento chegou.
    expect(ofType(carla, 'directory').length).toBeGreaterThan(0);
  });

  it('operação de B tampouco chega ao A', async () => {
    const backend = lab.tab();
    const marcos = await lab.join(backend, MARCOS);
    const helena = await lab.join(backend, HELENA);
    await helena.transport.registerAgent({ name: 'Agente BV', ilhaId: BV_ILHAS.atendimento });
    await helena.transport.setGrant({ userId: BV_USERS.paula, capability: 'chat.use', granted: false });
    expect(marcos.events).toEqual([]);
    expect(await marcos.transport.grantLog()).toEqual([]);
  });

  it('operação forjada não emite nada para ninguém, de nenhuma empresa, e o estado não muda', async () => {
    const backend = lab.tab();
    const probes = [
      await lab.join(backend, MARCOS),
      await lab.join(backend, CARLA),
      await lab.join(backend, ANA),
      await lab.join(backend, HELENA),
      await lab.join(backend, PAULA),
    ];
    const before = JSON.stringify(backend.server.toPersisted());
    const ana = probes[2];
    const marcos = probes[0];
    const carla = probes[1];
    if (!ana || !marcos || !carla) {
      throw new Error('sondas');
    }
    await rejection(ana.transport.setGrant({ userId: ICS_USERS.bruno, capability: 'chat.use', granted: false }));
    await rejection(ana.transport.deactivateUser({ userId: ICS_USERS.carla }));
    await rejection(carla.transport.setGrant({ userId: ICS_USERS.rafael, capability: 'chat.use', granted: false }));
    await rejection(carla.transport.setGrant({ userId: ICS_USERS.carla, capability: 'chat.use', granted: false }));
    await rejection(marcos.transport.setGrant({ userId: ICS_USERS.marcos, capability: 'chat.use', granted: false }));
    await rejection(marcos.transport.setGrant({ userId: BV_USERS.paula, capability: 'chat.use', granted: false }));
    await rejection(marcos.transport.deactivateUser({ userId: BV_USERS.paula }));
    await rejection(marcos.transport.moveAgent({ userId: BV_USERS.paula, ilhaId: ICS_ILHAS.norte }));
    await rejection(marcos.transport.registerAgent({ name: 'X', ilhaId: BV_ILHAS.atendimento }));
    await rejection(ana.transport.grantLog());
    for (const probe of probes) {
      expect(probe.events, `eventos de ${probe.session.userId}`).toEqual([]);
    }
    expect(JSON.stringify(backend.server.toPersisted())).toBe(before);
  });

  it('id inexistente e id da outra empresa dão o MESMO erro no transporte (classe, mensagem e motivo)', async () => {
    const backend = lab.tab();
    const marcos = await lab.join(backend, MARCOS);
    const t = marcos.transport;
    const ghostUser = 'ics-fantasma' as UserId;
    const ghostIlha = 'ics-ilha-fantasma' as IlhaId;
    const pairs: Array<[Promise<unknown>, Promise<unknown>]> = [
      [t.setGrant({ userId: BV_USERS.paula, capability: 'chat.use', granted: false }), t.setGrant({ userId: ghostUser, capability: 'chat.use', granted: false })],
      [t.deactivateUser({ userId: BV_USERS.paula }), t.deactivateUser({ userId: ghostUser })],
      [t.reactivateUser({ userId: BV_USERS.paula }), t.reactivateUser({ userId: ghostUser })],
      [t.moveAgent({ userId: BV_USERS.paula, ilhaId: ICS_ILHAS.sul }), t.moveAgent({ userId: ghostUser, ilhaId: ICS_ILHAS.sul })],
      [t.registerAgent({ name: 'X', ilhaId: BV_ILHAS.atendimento }), t.registerAgent({ name: 'X', ilhaId: ghostIlha })],
      [t.renameIlha({ ilhaId: BV_ILHAS.atendimento, name: 'X' }), t.renameIlha({ ilhaId: ghostIlha, name: 'X' })],
      [t.createIlha({ name: 'X', supervisorId: BV_USERS.otavio }), t.createIlha({ name: 'X', supervisorId: ghostUser })],
      [
        t.assignIlhaSupervisor({ ilhaId: ICS_ILHAS.norte, supervisorId: BV_USERS.otavio }),
        t.assignIlhaSupervisor({ ilhaId: ICS_ILHAS.norte, supervisorId: ghostUser }),
      ],
    ];
    for (const [foreign, missing] of pairs) {
      const a = await rejection(foreign);
      const b = await rejection(missing);
      expect([a.constructor, a.message, a.reason]).toEqual([b.constructor, b.message, b.reason]);
    }
  });
});

describe('administração no transporte: eventos e escopo do grantLog', () => {
  it('cada operação aceita chega ao tenant certo, sem reload, e o grantLog só a quem lê', async () => {
    const backend = lab.tab();
    const marcos = await lab.join(backend, MARCOS);
    const carla = await lab.join(backend, CARLA);
    const rafael = await lab.join(backend, RAFAEL);
    const ana = await lab.join(backend, ANA);

    const created = await marcos.transport.registerAgent({ name: 'Agente Novo', ilhaId: ICS_ILHAS.norte });
    for (const probe of [marcos, carla, rafael, ana]) {
      const [event] = ofType(probe, 'directory');
      expect(event?.directory.users[created.id]?.name, probe.session.userId).toBe('Agente Novo');
    }

    for (const probe of [marcos, carla, rafael, ana]) {
      probe.events.length = 0;
    }
    await marcos.transport.setGrant({ userId: ICS_USERS.ana, capability: 'chat.use', granted: false });
    for (const probe of [marcos, carla, rafael, ana]) {
      expect(ofType(probe, 'grants').at(-1)).toMatchObject({ userId: ICS_USERS.ana, grants: [] });
    }
    expect(ofType(marcos, 'grantLog').at(-1)?.entries).toHaveLength(1);
    expect(ofType(carla, 'grantLog').at(-1)?.entries).toHaveLength(1); // Ana é da ilha Norte (Carla)
    expect(ofType(rafael, 'grantLog')).toEqual([]);
    expect(ofType(ana, 'grantLog')).toEqual([]);
    expect(typesOf(ana.events).includes('grantLog')).toBe(false);

    // Leitura: o método devolve exatamente o escopo de cada um.
    expect((await marcos.transport.grantLog()).length).toBe(1);
    expect((await carla.transport.grantLog()).length).toBe(1);
    expect(await rafael.transport.grantLog()).toEqual([]);
    await rejection(ana.transport.grantLog());
  });

  it('o admin do outro tenant não recebe o log e a leitura dele vem vazia', async () => {
    const backend = lab.tab();
    const marcos = await lab.join(backend, MARCOS);
    const helena = await lab.join(backend, HELENA);
    await marcos.transport.setGrant({ userId: ICS_USERS.carla, capability: 'group.manage', granted: false });
    expect(helena.events).toEqual([]);
    expect(await helena.transport.grantLog()).toEqual([]);
  });

  it('desativar o ator não derruba a leitura de quem continua: o log mantém o autor mesmo desativado', async () => {
    const backend = lab.tab();
    const marcos = await lab.join(backend, MARCOS);
    const carla = await lab.join(backend, CARLA);
    await carla.transport.setGrant({ userId: ICS_USERS.ana, capability: 'chat.use', granted: false });
    await marcos.transport.deactivateUser({ userId: ICS_USERS.carla });
    const log = await marcos.transport.grantLog();
    expect(log).toHaveLength(1);
    expect(log[0]?.actorId).toBe(ICS_USERS.carla);
  });
});

describe('administração entre abas (TabSync)', () => {
  it('a operação numa aba chega como evento na outra sem reload; aba de outra empresa não recebe nada', async () => {
    const bus = new FakeBus();
    const tabA = lab.tab(bus);
    const tabB = lab.tab(bus);
    const marcos = await lab.join(tabA, MARCOS);
    const carla = await lab.join(tabB, CARLA);
    const rafael = await lab.join(tabB, RAFAEL);
    const paula = await lab.join(tabB, PAULA);
    const helena = await lab.join(tabB, HELENA);

    const created = await marcos.transport.registerSupervisor({ name: 'Supervisora Remota', ilhaIds: [] });
    const [directory] = ofType(carla, 'directory');
    expect(directory?.directory.users[created.id]).toMatchObject({ name: 'Supervisora Remota', role: 'supervisor' });
    expect(ofType(rafael, 'directory')).toHaveLength(1);
    expect(paula.events).toEqual([]);
    expect(helena.events).toEqual([]);

    carla.events.length = 0;
    const ilha = await marcos.transport.createIlha({ name: 'Ilha Remota', supervisorId: created.id });
    expect(ofType(carla, 'directory').at(-1)?.directory.ilhas[ilha.id]?.name).toBe('Ilha Remota');
    await marcos.transport.renameIlha({ ilhaId: ilha.id, name: 'Ilha Renomeada' });
    expect(ofType(carla, 'directory').at(-1)?.directory.ilhas[ilha.id]?.name).toBe('Ilha Renomeada');
    await marcos.transport.moveAgent({ userId: ICS_USERS.ana, ilhaId: ICS_ILHAS.sul });
    expect(ofType(carla, 'directory').at(-1)?.directory.users[ICS_USERS.ana]).toMatchObject({ ilhaId: ICS_ILHAS.sul });
    expect(paula.events).toEqual([]);
    expect(helena.events).toEqual([]);
  });

  it('grants e grantLog também atravessam a aba, filtrados por quem lê e por empresa', async () => {
    const bus = new FakeBus();
    const tabA = lab.tab(bus);
    const tabB = lab.tab(bus);
    const marcos = await lab.join(tabA, MARCOS);
    const carla = await lab.join(tabB, CARLA);
    const rafael = await lab.join(tabB, RAFAEL);
    const ana = await lab.join(tabB, ANA);
    const otavio = await lab.join(tabB, OTAVIO);

    await marcos.transport.setGrant({ userId: ICS_USERS.ana, capability: 'chat.use', granted: false });
    expect(ofType(carla, 'grants').at(-1)).toMatchObject({ userId: ICS_USERS.ana, grants: [] });
    expect(ofType(ana, 'grants').at(-1)).toMatchObject({ userId: ICS_USERS.ana, grants: [] });
    expect(ofType(carla, 'grantLog').at(-1)?.entries).toMatchObject([{ actorId: ICS_USERS.marcos, targetId: ICS_USERS.ana }]);
    expect(ofType(rafael, 'grantLog')).toEqual([]);
    expect(ofType(ana, 'grantLog')).toEqual([]);
    expect(otavio.events).toEqual([]);
    // O estado persistido já tem a entrada: a leitura na aba B a vê.
    expect(await carla.transport.grantLog()).toHaveLength(1);
  });

  it('um payload de grantLog forjado no canal nunca mostra a quem não lê o que não pode ver', async () => {
    const bus = new FakeBus();
    const tabA = lab.tab(bus);
    const marcos = await lab.join(tabA, MARCOS);
    const tabB = lab.tab(bus);
    const ana = await lab.join(tabB, ANA);
    await marcos.transport.setGrant({ userId: ICS_USERS.elisa, capability: 'chat.use', granted: false });
    const channel = bus.factory('sm-webchat-mock-v2');
    const entry = { tenantId: ICS_TENANT_ID, actorId: ICS_USERS.marcos, targetId: ICS_USERS.elisa, capability: 'chat.use', granted: false, at: 'x' };
    channel.postMessage({
      kind: 'deliveries',
      deliveries: [{ to: ICS_USERS.ana, event: { type: 'grantLog', tenantId: ICS_TENANT_ID, entries: [entry] } }],
    });
    expect(ofType(ana, 'grantLog')).toEqual([]);
    channel.close();
  });

  it('desativar numa aba derruba a sessão na outra, e a outra empresa nem percebe', async () => {
    const bus = new FakeBus();
    const tabA = lab.tab(bus);
    const tabB = lab.tab(bus);
    const marcos = await lab.join(tabA, MARCOS);
    const bruno = await lab.join(tabB, as(ICS_TENANT_ID, ICS_USERS.bruno));
    const paula = await lab.join(tabB, PAULA);
    await marcos.transport.deactivateUser({ userId: ICS_USERS.bruno });
    expect(ofType(bruno, 'session-ended')).toEqual([{ type: 'session-ended', tenantId: ICS_TENANT_ID, reason: 'deactivated' }]);
    expect(bruno.transport.getStatus()).toBe('disconnected');
    expect(paula.events).toEqual([]);
    expect(paula.transport.getStatus()).toBe('connected');
    await expect(bruno.transport.send({ conversationId: asConversationId('x'), clientId: 'c', payload: { type: 'text', text: 'oi' } })).rejects.toThrow();
    await expect(bruno.transport.setGrant({ userId: ICS_USERS.ana, capability: 'chat.use', granted: false })).rejects.toThrow();
    await expect(bruno.transport.grantLog()).rejects.toThrow();
  });

  it('se o aviso entre abas se perde, o estado persistido derruba e atualiza mesmo assim', async () => {
    vi.useFakeTimers();
    const tabA = lab.tab(new FakeBus());
    const tabB = lab.tab(new FakeBus()); // outro barramento: nenhum aviso de A chega a B
    const marcos = await lab.join(tabA, MARCOS);
    const bruno = await lab.join(tabB, as(ICS_TENANT_ID, ICS_USERS.bruno));
    const carla = await lab.join(tabB, CARLA);
    const paula = await lab.join(tabB, PAULA);
    await marcos.transport.registerAgent({ name: 'Perdido', ilhaId: ICS_ILHAS.sul });
    await marcos.transport.deactivateUser({ userId: ICS_USERS.bruno });
    expect(carla.events).toEqual([]);
    await vi.advanceTimersByTimeAsync(600);
    expect(ofType(carla, 'directory').length).toBeGreaterThan(0);
    expect(ofType(bruno, 'session-ended')).toHaveLength(1);
    expect(bruno.transport.getStatus()).toBe('disconnected');
    expect(paula.events).toEqual([]);
  });
});

describe('administração: persistência e login', () => {
  it('diretório, ilhas e grantLog sobrevivem ao reload (outro servidor sobre o mesmo storage)', async () => {
    const first = lab.tab();
    const marcos = await lab.join(first, MARCOS);
    const agent = await marcos.transport.registerAgent({ name: 'Zélia Persistida', ilhaId: ICS_ILHAS.norte });
    const ilha = await marcos.transport.createIlha({ name: 'Ilha Persistida', supervisorId: ICS_USERS.rafael });
    await marcos.transport.setGrant({ userId: agent.id, capability: 'chat.use', granted: false });
    await marcos.transport.deactivateUser({ userId: ICS_USERS.bruno });

    const reloaded = lab.tab();
    const state = reloaded.server.getState().get(ICS_TENANT_ID);
    expect(state?.directory.users[agent.id]).toMatchObject({ name: 'Zélia Persistida', role: 'agent', ilhaId: ICS_ILHAS.norte });
    expect(state?.directory.users[agent.id]?.grants.has('chat.use')).toBe(false);
    expect(state?.directory.users[ICS_USERS.bruno]?.active).toBe(false);
    expect(state?.directory.ilhas[ilha.id]?.name).toBe('Ilha Persistida');
    expect(state?.grantLog).toHaveLength(1);
    const again = await lab.join(reloaded, MARCOS);
    expect(await again.transport.grantLog()).toHaveLength(1);
  });

  it('"Entrar como" lê o estado do servidor: o recém-cadastrado aparece depois de recriar o servidor', async () => {
    const first = lab.tab();
    const marcos = await lab.join(first, MARCOS);
    const agent = await marcos.transport.registerAgent({ name: 'Zélia Nova', ilhaId: ICS_ILHAS.sul });
    const supervisor = await marcos.transport.registerSupervisor({ name: 'Sérgio Novo', ilhaIds: [] });
    const reloaded = lab.tab();
    const ics = reloaded.server.loginGroups().find((group) => group.tenant.id === ICS_TENANT_ID);
    const names = ics?.users.map((user) => user.name) ?? [];
    expect(names).toContain('Zélia Nova');
    expect(names).toContain('Sérgio Novo');
    expect(ics?.users.find((user) => user.id === agent.id)?.active).toBe(true);
    expect(ics?.users.find((user) => user.id === supervisor.id)?.role).toBe('supervisor');
    // O recém-cadastrado entra.
    const entered = await lab.join(reloaded, { tenantId: ICS_TENANT_ID, userId: agent.id });
    expect(entered.transport.getStatus()).toBe('connected');
    // E o BV não ganhou ninguém.
    expect(reloaded.server.loginGroups().find((group) => group.tenant.id === BV_TENANT_ID)?.users).toHaveLength(4);
  });

  it('migra o estado salvo pela Etapa 4 (versão 2, sem grantLog nem épocas) sem perder nada', async () => {
    const seeded = lab.tab();
    const persisted = seeded.server.toPersisted();
    const legacy = {
      ...persisted,
      version: 2,
      tenants: persisted.tenants.map((tenant) =>
        Object.fromEntries(Object.entries(tenant).filter(([key]) => key !== 'grantLog')),
      ),
    };
    expect(legacy.tenants.every((tenant) => !('grantLog' in tenant))).toBe(true);
    const migrated = new MockBackend({ store: rawStore(legacy), now: () => '2026-11-16T12:00:00.000Z' });
    const ics = migrated.server.getState().get(ICS_TENANT_ID);
    expect(ics?.grantLog).toEqual([]);
    expect(Object.keys(ics?.directory.users ?? {})).toHaveLength(9);
    expect(Object.values(ics?.messages ?? {}).flat().length).toBeGreaterThan(0);
    // Ele funciona e a próxima gravação já sai na versão nova.
    const transport = new MockTransport({ backend: migrated, delays: { connectMs: 0 } });
    await transport.connect(MARCOS);
    await transport.setGrant({ userId: ICS_USERS.ana, capability: 'chat.use', granted: false });
    expect(migrated.server.toPersisted().version).toBe(4);
    expect(migrated.server.getState().get(ICS_TENANT_ID)?.grantLog).toHaveLength(1);
    transport.disconnect();
    migrated.close();
  });

  it('estado de versão nova com grantLog adulterado (outro tenant, ator inexistente, capacidade inventada) é descartado', () => {
    const seeded = lab.tab();
    const persisted = seeded.server.toPersisted();
    const bad = [
      { tenantId: BV_TENANT_ID, actorId: ICS_USERS.marcos, targetId: ICS_USERS.ana, capability: 'chat.use', granted: false, at: 'x' },
      { tenantId: ICS_TENANT_ID, actorId: 'ninguem', targetId: ICS_USERS.ana, capability: 'chat.use', granted: false, at: 'x' },
      { tenantId: ICS_TENANT_ID, actorId: ICS_USERS.marcos, targetId: ICS_USERS.ana, capability: 'inventada', granted: false, at: 'x' },
      { tenantId: ICS_TENANT_ID, actorId: ICS_USERS.marcos, targetId: ICS_USERS.ana, capability: 'chat.use', granted: 'sim', at: 'x' },
    ];
    for (const entry of bad) {
      const tampered = {
        ...persisted,
        tenants: persisted.tenants.map((tenant) => (tenant.tenant.id === ICS_TENANT_ID ? { ...tenant, grantLog: [entry] } : tenant)),
      };
      const loaded = new MockBackend({ store: rawStore(tampered) });
      // Estado inválido: o servidor recomeça da seed (log vazio), nunca com a entrada adulterada.
      expect(loaded.server.getState().get(ICS_TENANT_ID)?.grantLog).toEqual([]);
      loaded.close();
    }
  });
});
