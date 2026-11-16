import fc from 'fast-check';
import { CAPABILITIES, type Capability } from '../../domain/capabilities';
import type { ConversationId } from '../../domain/conversation';
import { validateDirectory, type IlhaId, type UserId } from '../../domain/identity';
import type { TenantId } from '../../domain/tenant';
import { MockServer, type Delivery, type Outcome, type Session } from './MockServer';
import { BV_TENANT_ID, createSeedState, ICS_TENANT_ID } from './seed';

/**
 * §2.11: sequências aleatórias sobre 2 tenants, com ids do outro tenant misturados.
 * A cada passo: (1) todo evento entregue a `u` é do tenant de `u` (e de conversa em que `u` participa);
 * (2) o Bootstrap serializado de qualquer usuário não contém id do outro tenant;
 * (3) nenhuma operação que referencia id de outro tenant teve sucesso.
 */

const NOW = '2026-11-13T12:00:00.000Z';

type Operation =
  | { kind: 'connect'; who: number; foreignTenant: boolean }
  | { kind: 'send'; conversation: number; who: number; mode: Mode; text: number }
  | { kind: 'openDirect'; who: number; target: number; mode: Mode }
  | { kind: 'markRead'; conversation: number; who: number; mode: Mode; message: number }
  | { kind: 'typing'; conversation: number; who: number; mode: Mode }
  | { kind: 'grant'; who: number; target: number; mode: Mode; capability: Capability; granted: boolean }
  // Etapa 5: operações administrativas (ilhas, usuários e alvos misturados entre os dois tenants).
  | { kind: 'registerSupervisor'; who: number; ilha: number; mode: Mode; name: number }
  | { kind: 'registerAgent'; who: number; ilha: number; mode: Mode; name: number }
  | { kind: 'setActive'; who: number; target: number; mode: Mode; active: boolean }
  | { kind: 'createIlha'; who: number; supervisor: number; mode: Mode; name: number }
  | { kind: 'renameIlha'; who: number; ilha: number; mode: Mode; name: number }
  | { kind: 'assignSupervisor'; who: number; ilha: number; supervisor: number; mode: Mode; foreignSupervisor: boolean }
  | { kind: 'moveAgent'; who: number; agent: number; ilha: number; mode: Mode; foreignIlha: boolean };

/** member = ator do mesmo tenant da referência; foreign = do outro; any = sorteado; admin = o admin da referência. */
type Mode = 'member' | 'foreign' | 'any' | 'admin';

const mode = fc.constantFrom<Mode>('member', 'member', 'foreign', 'any', 'admin');
const index = fc.nat(1000);
const operation: fc.Arbitrary<Operation> = fc.oneof(
  { weight: 2, arbitrary: fc.record({ kind: fc.constant('connect' as const), who: index, foreignTenant: fc.boolean() }) },
  { weight: 6, arbitrary: fc.record({ kind: fc.constant('send' as const), conversation: index, who: index, mode, text: fc.nat(99) }) },
  { weight: 3, arbitrary: fc.record({ kind: fc.constant('openDirect' as const), who: index, target: index, mode }) },
  { weight: 3, arbitrary: fc.record({ kind: fc.constant('markRead' as const), conversation: index, who: index, mode, message: index }) },
  { weight: 2, arbitrary: fc.record({ kind: fc.constant('typing' as const), conversation: index, who: index, mode }) },
  {
    weight: 2,
    arbitrary: fc.record({
      kind: fc.constant('grant' as const),
      who: index,
      target: index,
      mode,
      capability: fc.constantFrom(...CAPABILITIES),
      granted: fc.boolean(),
    }),
  },
  { weight: 2, arbitrary: fc.record({ kind: fc.constant('registerSupervisor' as const), who: index, ilha: index, mode, name: fc.nat(9) }) },
  { weight: 3, arbitrary: fc.record({ kind: fc.constant('registerAgent' as const), who: index, ilha: index, mode, name: fc.nat(9) }) },
  { weight: 3, arbitrary: fc.record({ kind: fc.constant('setActive' as const), who: index, target: index, mode, active: fc.boolean() }) },
  { weight: 2, arbitrary: fc.record({ kind: fc.constant('createIlha' as const), who: index, supervisor: index, mode, name: fc.nat(9) }) },
  { weight: 2, arbitrary: fc.record({ kind: fc.constant('renameIlha' as const), who: index, ilha: index, mode, name: fc.nat(9) }) },
  {
    weight: 2,
    arbitrary: fc.record({
      kind: fc.constant('assignSupervisor' as const),
      who: index,
      ilha: index,
      supervisor: index,
      mode,
      foreignSupervisor: fc.boolean(),
    }),
  },
  {
    weight: 3,
    arbitrary: fc.record({
      kind: fc.constant('moveAgent' as const),
      who: index,
      agent: index,
      ilha: index,
      mode,
      foreignIlha: fc.boolean(),
    }),
  },
);

type Stats = {
  steps: number;
  accepted: number;
  acceptedByKind: Map<string, number>;
  /** Aceitas que MUDARAM algo (geraram evento): `no-change` não conta. */
  changedByKind: Map<string, number>;
  crossAttempts: number;
  crossRejected: number;
};

const newStats = (): Stats => ({ steps: 0, accepted: 0, acceptedByKind: new Map(), changedByKind: new Map(), crossAttempts: 0, crossRejected: 0 });

/** Roda uma campanha de sequências aleatórias com contadores PRÓPRIOS (cada teste tem a sua). */
function campaign(numRuns: number, seed?: number): Stats {
  const stats = newStats();
  fc.assert(
    fc.property(fc.array(operation, { minLength: 15, maxLength: 50 }), (operations) => {
      const world = new World();
      for (const op of operations) {
        const { deliveries } = apply(world, op, stats);
        stats.steps += 1;
        checkDeliveries(world, deliveries);
        checkBootstraps(world);
        checkAdminInvariants(world);
      }
    }),
    { numRuns, ...(seed === undefined ? {} : { seed }) },
  );
  return stats;
}

function json(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) => (item instanceof Set ? [...(item as Set<string>)] : item));
}

class World {
  readonly server = new MockServer(createSeedState(NOW), { now: () => NOW });
  readonly tenantOfUser = new Map<UserId, TenantId>();
  readonly users: UserId[] = [];
  readonly admins = new Map<TenantId, UserId>();
  /** Nomes novos têm de ser únicos só para não cair em `no-change` (renomear igual). */
  private names = 0;

  constructor() {
    for (const [tenantId, ts] of this.server.getState()) {
      for (const user of Object.values(ts.directory.users)) {
        this.tenantOfUser.set(user.id, tenantId);
        this.users.push(user.id);
        if (user.role === 'admin') {
          this.admins.set(tenantId, user.id);
        }
      }
    }
  }

  isSupervisor(userId: UserId): boolean {
    return this.server.getState().get(this.tenant(userId))?.directory.users[userId]?.role === 'supervisor';
  }

  /** Usuário cadastrado durante a sequência passa a existir no mundo. */
  adopt(userId: UserId, tenantId: TenantId): void {
    this.tenantOfUser.set(userId, tenantId);
    this.users.push(userId);
  }

  uniqueName(prefix: string): string {
    this.names += 1;
    return `${prefix} ${String(this.names)}`;
  }

  /** Todas as ilhas dos dois tenants (tenant dono lido do estado). */
  ilhas(): Array<{ id: IlhaId; tenantId: TenantId }> {
    return [...this.server.getState()].flatMap(([tenantId, ts]) => Object.keys(ts.directory.ilhas).map((id) => ({ id: id as IlhaId, tenantId })));
  }

  /** Ilhas de um tenant. */
  ilhasOf(tenantId: TenantId): Array<{ id: IlhaId; tenantId: TenantId }> {
    return this.ilhas().filter((ilha) => ilha.tenantId === tenantId);
  }

  otherTenant(tenantId: TenantId): TenantId {
    const other = [...this.server.getState().keys()].find((id) => id !== tenantId);
    if (!other) {
      throw new Error('esperava 2 tenants');
    }
    return other;
  }

  tenant(userId: UserId): TenantId {
    const found = this.tenantOfUser.get(userId);
    if (!found) {
      throw new Error(`usuário fora do mundo: ${userId}`);
    }
    return found;
  }

  session(userId: UserId): Session {
    return { tenantId: this.tenant(userId), userId };
  }

  /** Todas as conversas dos dois tenants (com o tenant dono, lido do estado, não do id). */
  conversations(): Array<{ id: ConversationId; tenantId: TenantId; participants: readonly UserId[]; messages: string[] }> {
    const all: Array<{ id: ConversationId; tenantId: TenantId; participants: readonly UserId[]; messages: string[] }> = [];
    for (const [tenantId, ts] of this.server.getState()) {
      for (const conversation of Object.values(ts.conversations)) {
        const participants = conversation.kind === 'direct' ? conversation.participants : conversation.members;
        all.push({
          id: conversation.id,
          tenantId,
          participants,
          messages: (ts.messages[conversation.id] ?? []).map((message) => message.id),
        });
      }
    }
    return all;
  }

  /** Ator escolhido conforme o modo, em relação ao tenant da referência. */
  actor(who: number, referenceTenant: TenantId, selected: Mode): UserId {
    if (selected === 'admin') {
      const admin = this.admins.get(referenceTenant);
      if (admin) {
        return admin;
      }
    }
    const pool =
      selected === 'any'
        ? this.users
        : this.users.filter((id) => (this.tenant(id) === referenceTenant) === (selected !== 'foreign'));
    const list = pool.length > 0 ? pool : this.users;
    return list[who % list.length] as UserId;
  }
}

function checkDeliveries(world: World, deliveries: readonly Delivery[]): void {
  const conversations = world.conversations();
  for (const { to, event } of deliveries) {
    const tenantOfRecipient = world.tenant(to);
    expect(event.tenantId).toBe(tenantOfRecipient);
    let conversationId: ConversationId | undefined;
    switch (event.type) {
      case 'message':
        expect(event.message.tenantId).toBe(tenantOfRecipient);
        conversationId = event.message.conversationId;
        break;
      case 'conversation':
        expect(event.conversation.tenantId).toBe(tenantOfRecipient);
        conversationId = event.conversation.id;
        break;
      case 'status':
      case 'typing':
      case 'read':
        conversationId = event.conversationId;
        break;
      case 'grants':
        expect(world.tenant(event.userId)).toBe(tenantOfRecipient);
        break;
      case 'directory': {
        expect(event.directory.tenantId).toBe(tenantOfRecipient);
        const members = Object.values(event.directory.users);
        expect(members.every((user) => user.tenantId === tenantOfRecipient)).toBe(true);
        expect(Object.values(event.directory.ilhas).every((ilha) => ilha.tenantId === tenantOfRecipient)).toBe(true);
        // Só vai a quem está ativo no diretório que recebe.
        expect(event.directory.users[to]?.active).toBe(true);
        break;
      }
      case 'grantLog': {
        expect(event.entries.every((entry) => entry.tenantId === tenantOfRecipient)).toBe(true);
        expect(event.entries.every((entry) => world.tenant(entry.actorId) === tenantOfRecipient && world.tenant(entry.targetId) === tenantOfRecipient)).toBe(true);
        // Agente nunca recebe o log.
        expect(world.server.getState().get(tenantOfRecipient)?.directory.users[to]?.role).not.toBe('agent');
        break;
      }
    }
    if (conversationId) {
      const found = conversations.find((item) => item.id === conversationId);
      expect(found?.tenantId).toBe(tenantOfRecipient);
      expect(found?.participants).toContain(to);
    }
  }
}

function checkBootstraps(world: World): void {
  const state = world.server.getState();
  for (const userId of world.users) {
    const mine = world.tenant(userId);
    const other = [...state.keys()].find((id) => id !== mine);
    const foreign = other ? state.get(other) : undefined;
    if (!foreign) {
      throw new Error('esperava 2 tenants');
    }
    const foreignIds = [
      foreign.tenant.id,
      ...Object.keys(foreign.directory.users),
      ...Object.keys(foreign.directory.ilhas),
      ...Object.keys(foreign.conversations),
      ...Object.values(foreign.messages).flatMap((list) => list.map((message) => message.id)),
    ];
    const bootstrap = world.server.bootstrap(world.session(userId));
    // Desativado não tem sessão: nem Bootstrap nem log.
    const active = state.get(mine)?.directory.users[userId]?.active === true;
    expect(bootstrap.ok).toBe(active);
    if (!active) {
      expect(world.server.grantLog(world.session(userId)).ok).toBe(false);
    }
    if (!bootstrap.ok) {
      continue;
    }
    const serialized = json(bootstrap.value);
    for (const id of foreignIds) {
      expect(serialized).not.toContain(`"${id}"`);
    }
    // O grantLog legível por ele também não traz nada do outro tenant.
    const log = world.server.grantLog(world.session(userId));
    const serializedLog = json(log.ok ? log.value : []);
    for (const id of foreignIds) {
      expect(serializedLog).not.toContain(`"${id}"`);
    }
  }
}

/** Invariantes do estado depois de CADA passo, aceito ou não. */
function checkAdminInvariants(world: World): void {
  for (const [tenantId, ts] of world.server.getState()) {
    expect(validateDirectory(ts.directory).ok, `diretório de ${tenantId} inválido`).toBe(true);
    expect(ts.grantLog.every((entry) => entry.tenantId === tenantId)).toBe(true);
    expect(ts.grantLog.every((entry) => world.tenant(entry.actorId) === tenantId && world.tenant(entry.targetId) === tenantId)).toBe(true);
    expect(Object.values(ts.directory.users).filter((user) => user.role === 'admin')).toHaveLength(1);
    expect(Object.values(ts.directory.ilhas).every((ilha) => ts.directory.users[ilha.supervisorId]?.role === 'supervisor')).toBe(true);
  }
}

/** Executa uma operação e confere (3). Devolve as entregas e se foi aceita. */
function apply(world: World, op: Operation, stats: Stats): { deliveries: Delivery[]; accepted: boolean } {
  const { server } = world;
  const conversations = world.conversations();
  const pickConversation = (): (typeof conversations)[number] | undefined =>
    conversations[(op as { conversation: number }).conversation % Math.max(1, conversations.length)];
  const ilhas = world.ilhas();
  const pickIlha = (position: number): (typeof ilhas)[number] => {
    const found = ilhas[position % Math.max(1, ilhas.length)];
    if (!found) {
      throw new Error('mundo sem ilhas');
    }
    return found;
  };
  /** Recusada = ForbiddenError, nenhum evento e o estado persistido INTEIRO idêntico. Aceita: adota o cadastrado. */
  const before = JSON.stringify(server.toPersisted());
  const settle = <T,>(outcome: Outcome<T>): { deliveries: Delivery[]; accepted: boolean } => {
    if (!outcome.result.ok) {
      expect(outcome.deliveries).toEqual([]);
      expect(JSON.stringify(server.toPersisted())).toBe(before);
      return { deliveries: [], accepted: false };
    }
    return { deliveries: outcome.deliveries, accepted: true };
  };
  let deliveries: Delivery[] = [];
  let accepted = false;
  let cross = false;
  switch (op.kind) {
    case 'connect': {
      const userId = world.users[op.who % world.users.length] as UserId;
      const real = world.tenant(userId);
      const claimed = op.foreignTenant ? (real === ICS_TENANT_ID ? BV_TENANT_ID : ICS_TENANT_ID) : real;
      cross = claimed !== real;
      const outcome = server.connect({ tenantId: claimed, userId });
      deliveries = outcome.deliveries;
      accepted = outcome.result.ok;
      break;
    }
    case 'send': {
      const conversation = pickConversation();
      if (!conversation) {
        break;
      }
      const userId = world.actor(op.who, conversation.tenantId, op.mode);
      cross = world.tenant(userId) !== conversation.tenantId;
      const outcome = server.send(world.session(userId), {
        conversationId: conversation.id,
        clientId: `c-${String(op.text)}-${userId}`,
        payload: { type: 'text', text: `texto ${String(op.text)}` },
      });
      deliveries = outcome.deliveries;
      accepted = outcome.result.ok;
      break;
    }
    case 'openDirect': {
      const target = world.users[op.target % world.users.length] as UserId;
      const userId = world.actor(op.who, world.tenant(target), op.mode);
      cross = world.tenant(userId) !== world.tenant(target);
      const outcome = server.openDirect(world.session(userId), { with: target });
      deliveries = outcome.deliveries;
      accepted = outcome.result.ok;
      break;
    }
    case 'markRead': {
      const conversation = pickConversation();
      if (!conversation) {
        break;
      }
      const every = conversations.flatMap((item) => item.messages.map((id) => ({ id, tenantId: item.tenantId })));
      const own = conversation.messages;
      // Mensagem: da própria conversa (quando houver) ou de qualquer conversa dos dois tenants.
      const messageId =
        op.mode === 'member' && own.length > 0
          ? (own[op.message % own.length] as string)
          : (every[op.message % Math.max(1, every.length)]?.id ?? 'sem-mensagem');
      const messageTenant = every.find((item) => item.id === messageId)?.tenantId ?? conversation.tenantId;
      const userId = world.actor(op.who, conversation.tenantId, op.mode);
      cross = world.tenant(userId) !== conversation.tenantId || messageTenant !== conversation.tenantId;
      const outcome = server.markRead(world.session(userId), { conversationId: conversation.id, upToMessageId: messageId });
      deliveries = outcome.deliveries;
      accepted = outcome.result.ok;
      break;
    }
    case 'typing': {
      const conversation = pickConversation();
      if (!conversation) {
        break;
      }
      const userId = world.actor(op.who, conversation.tenantId, op.mode);
      cross = world.tenant(userId) !== conversation.tenantId;
      const outcome = server.setTyping(world.session(userId), { conversationId: conversation.id, isTyping: true });
      deliveries = outcome.deliveries;
      accepted = outcome.result.ok;
      break;
    }
    case 'grant': {
      const target = world.users[op.target % world.users.length] as UserId;
      const userId = world.actor(op.who, world.tenant(target), op.mode);
      cross = world.tenant(userId) !== world.tenant(target);
      const outcome = server.setGrant(world.session(userId), {
        userId: target,
        capability: op.capability,
        granted: op.granted,
      });
      deliveries = outcome.deliveries;
      accepted = outcome.result.ok;
      break;
    }
    case 'registerSupervisor': {
      const ilha = pickIlha(op.ilha);
      const userId = world.actor(op.who, ilha.tenantId, op.mode);
      cross = world.tenant(userId) !== ilha.tenantId;
      const outcome = server.registerSupervisor(world.session(userId), { name: world.uniqueName('Sup'), ilhaIds: [ilha.id] });
      if (outcome.result.ok) {
        world.adopt(outcome.result.value.id, world.tenant(userId));
      }
      ({ deliveries, accepted } = settle(outcome));
      break;
    }
    case 'registerAgent': {
      const ilha = pickIlha(op.ilha);
      const userId = world.actor(op.who, ilha.tenantId, op.mode);
      cross = world.tenant(userId) !== ilha.tenantId;
      const outcome = server.registerAgent(world.session(userId), { name: world.uniqueName('Ag'), ilhaId: ilha.id });
      if (outcome.result.ok) {
        world.adopt(outcome.result.value.id, world.tenant(userId));
      }
      ({ deliveries, accepted } = settle(outcome));
      break;
    }
    case 'setActive': {
      const target = world.users[op.target % world.users.length] as UserId;
      const userId = world.actor(op.who, world.tenant(target), op.mode);
      cross = world.tenant(userId) !== world.tenant(target);
      const outcome = op.active
        ? server.reactivateUser(world.session(userId), { userId: target })
        : server.deactivateUser(world.session(userId), { userId: target });
      ({ deliveries, accepted } = settle(outcome));
      break;
    }
    case 'createIlha': {
      const everyone = world.users.filter((id) => op.supervisor % 4 === 0 || world.isSupervisor(id));
      const supervisor = everyone[op.supervisor % Math.max(1, everyone.length)] ?? world.users[0];
      if (!supervisor) {
        break;
      }
      const userId = world.actor(op.who, world.tenant(supervisor), op.mode);
      cross = world.tenant(userId) !== world.tenant(supervisor);
      const outcome = server.createIlha(world.session(userId), { name: world.uniqueName('Ilha'), supervisorId: supervisor });
      ({ deliveries, accepted } = settle(outcome));
      break;
    }
    case 'renameIlha': {
      const ilha = pickIlha(op.ilha);
      const userId = world.actor(op.who, ilha.tenantId, op.mode);
      cross = world.tenant(userId) !== ilha.tenantId;
      const outcome = server.renameIlha(world.session(userId), { ilhaId: ilha.id, name: world.uniqueName('Renomeada') });
      ({ deliveries, accepted } = settle(outcome));
      break;
    }
    case 'assignSupervisor': {
      const ilha = pickIlha(op.ilha);
      const userId = world.actor(op.who, ilha.tenantId, op.mode);
      const supervisorTenant = op.foreignSupervisor ? world.otherTenant(ilha.tenantId) : ilha.tenantId;
      // Na maior parte das vezes um supervisor de verdade (para haver atribuições aceitas); às vezes qualquer usuário.
      const supervisorPool = world.users.filter(
        (id) => world.tenant(id) === supervisorTenant && (op.supervisor % 4 === 0 || world.isSupervisor(id)),
      );
      const supervisor = supervisorPool[op.supervisor % Math.max(1, supervisorPool.length)] ?? userId;
      cross = world.tenant(userId) !== ilha.tenantId || world.tenant(supervisor) !== ilha.tenantId;
      const outcome = server.assignIlhaSupervisor(world.session(userId), { ilhaId: ilha.id, supervisorId: supervisor });
      ({ deliveries, accepted } = settle(outcome));
      break;
    }
    case 'moveAgent': {
      const agent = world.users[op.agent % world.users.length] as UserId;
      const destinations = world.ilhasOf(op.foreignIlha ? world.otherTenant(world.tenant(agent)) : world.tenant(agent));
      const destination = destinations[op.ilha % Math.max(1, destinations.length)];
      if (!destination) {
        break;
      }
      const userId = world.actor(op.who, world.tenant(agent), op.mode);
      cross = world.tenant(userId) !== world.tenant(agent) || destination.tenantId !== world.tenant(agent);
      const outcome = server.moveAgent(world.session(userId), { userId: agent, ilhaId: destination.id });
      ({ deliveries, accepted } = settle(outcome));
      break;
    }
  }
  if (cross) {
    stats.crossAttempts += 1;
    expect(accepted).toBe(false);
    expect(deliveries).toEqual([]);
    stats.crossRejected += 1;
  }
  if (accepted) {
    stats.accepted += 1;
    stats.acceptedByKind.set(op.kind, (stats.acceptedByKind.get(op.kind) ?? 0) + 1);
    if (deliveries.length > 0) {
      stats.changedByKind.set(op.kind, (stats.changedByKind.get(op.kind) ?? 0) + 1);
    }
  }
  return { deliveries, accepted };
}

describe('isolamento entre tenants (propriedade)', () => {
  it('nenhum evento, Bootstrap ou operação atravessa o tenant em sequências de até 50 operações', () => {
    campaign(40);
  }, 60_000);

  it('as sequências não são vacuas: há operações aceitas de cada tipo e tentativas cross-tenant recusadas', () => {
    // Semente fixa: este teste mede COBERTURA (contagens), então precisa ser determinístico. A campanha acima segue aleatória.
    const stats = campaign(40, 20261116);
    expect(stats.steps).toBeGreaterThan(250);
    expect(stats.accepted).toBeGreaterThan(100);
    for (const kind of ['connect', 'send', 'openDirect', 'markRead', 'typing', 'grant']) {
      expect(stats.acceptedByKind.get(kind) ?? 0, `aceitas: ${kind}`).toBeGreaterThan(0);
    }
    for (const kind of ['registerSupervisor', 'registerAgent', 'setActive', 'createIlha', 'renameIlha', 'assignSupervisor', 'moveAgent']) {
      expect(stats.changedByKind.get(kind) ?? 0, `aceitas e com efeito: ${kind}`).toBeGreaterThan(0);
    }
    expect(stats.crossAttempts).toBeGreaterThan(50);
    expect(stats.crossRejected).toBe(stats.crossAttempts);
  }, 60_000);
});
