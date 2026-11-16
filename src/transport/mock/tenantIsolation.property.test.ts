import fc from 'fast-check';
import { CAPABILITIES, type Capability } from '../../domain/capabilities';
import type { ConversationId } from '../../domain/conversation';
import type { UserId } from '../../domain/identity';
import type { TenantId } from '../../domain/tenant';
import { MockServer, type Delivery, type Session } from './MockServer';
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
  | { kind: 'grant'; who: number; target: number; mode: Mode; capability: Capability; granted: boolean };

/** member = ator do mesmo tenant da referência; foreign = do outro; any = sorteado. */
type Mode = 'member' | 'foreign' | 'any';

const mode = fc.constantFrom<Mode>('member', 'member', 'foreign', 'any');
const index = fc.nat(1000);
const operation: fc.Arbitrary<Operation> = fc.oneof(
  { weight: 2, arbitrary: fc.record({ kind: fc.constant('connect' as const), who: index, foreignTenant: fc.boolean() }) },
  { weight: 6, arbitrary: fc.record({ kind: fc.constant('send' as const), conversation: index, who: index, mode, text: fc.nat(99) }) },
  { weight: 3, arbitrary: fc.record({ kind: fc.constant('openDirect' as const), who: index, target: index, mode }) },
  { weight: 3, arbitrary: fc.record({ kind: fc.constant('markRead' as const), conversation: index, who: index, mode, message: index }) },
  { weight: 1, arbitrary: fc.record({ kind: fc.constant('typing' as const), conversation: index, who: index, mode }) },
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
);

type Stats = {
  steps: number;
  accepted: number;
  acceptedByKind: Map<string, number>;
  crossAttempts: number;
  crossRejected: number;
};

const newStats = (): Stats => ({ steps: 0, accepted: 0, acceptedByKind: new Map(), crossAttempts: 0, crossRejected: 0 });

/** Roda uma campanha de sequências aleatórias com contadores PRÓPRIOS (cada teste tem a sua). */
function campaign(numRuns: number): Stats {
  const stats = newStats();
  fc.assert(
    fc.property(fc.array(operation, { minLength: 15, maxLength: 50 }), (operations) => {
      const world = new World();
      for (const op of operations) {
        const { deliveries } = apply(world, op, stats);
        stats.steps += 1;
        checkDeliveries(world, deliveries);
        checkBootstraps(world);
      }
    }),
    { numRuns },
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

  constructor() {
    for (const [tenantId, ts] of this.server.getState()) {
      for (const id of Object.keys(ts.directory.users) as UserId[]) {
        this.tenantOfUser.set(id, tenantId);
        this.users.push(id);
      }
    }
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
    const pool =
      selected === 'any'
        ? this.users
        : this.users.filter((id) => (this.tenant(id) === referenceTenant) === (selected === 'member'));
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
    expect(bootstrap.ok).toBe(true);
    if (!bootstrap.ok) {
      continue;
    }
    const serialized = json(bootstrap.value);
    for (const id of foreignIds) {
      expect(serialized).not.toContain(`"${id}"`);
    }
  }
}

/** Executa uma operação e confere (3). Devolve as entregas e se foi aceita. */
function apply(world: World, op: Operation, stats: Stats): { deliveries: Delivery[]; accepted: boolean } {
  const { server } = world;
  const conversations = world.conversations();
  const pickConversation = (): (typeof conversations)[number] | undefined =>
    conversations[(op as { conversation: number }).conversation % Math.max(1, conversations.length)];
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
  }
  return { deliveries, accepted };
}

describe('isolamento entre tenants (propriedade)', () => {
  it('nenhum evento, Bootstrap ou operação atravessa o tenant em sequências de até 50 operações', () => {
    campaign(40);
  }, 60_000);

  it('as sequências não são vacuas: há operações aceitas de cada tipo e tentativas cross-tenant recusadas', () => {
    const stats = campaign(20);
    expect(stats.steps).toBeGreaterThan(250);
    expect(stats.accepted).toBeGreaterThan(100);
    for (const kind of ['connect', 'send', 'openDirect', 'markRead', 'typing', 'grant']) {
      expect(stats.acceptedByKind.get(kind) ?? 0, `aceitas: ${kind}`).toBeGreaterThan(0);
    }
    expect(stats.crossAttempts).toBeGreaterThan(50);
    expect(stats.crossRejected).toBe(stats.crossAttempts);
  }, 60_000);
});
