import { messageFromPayload } from '../../chat/outbound';
import {
  directConversation,
  asConversationId,
  asMessageId,
  createGroup as buildGroup,
  groupMessageRead,
  updateGroup as reviseGroup,
  type GroupConversation,
  type SystemMessage,
  type Conversation,
  type ConversationId,
  type ConversationSummary,
  type DirectConversation,
} from '@viavoip/internal-domain';
import {
  addAgentToIlha,
  assignIlhaSupervisor,
  canConnect,
  createIlha,
  deactivateUser,
  grantCapability,
  removeAgentFromIlha,
  unassignIlhaSupervisor,
  reactivateUser,
  registerAgent,
  registerSupervisor,
  renameIlha,
  revokeCapability,
  type AdminResult,
  type AdminState,
  type GrantLogEntry,
  type OpDeps,
  type OpError,
} from '@viavoip/internal-domain';
import { canReadGrantLog, visibleGrantLog } from '@viavoip/internal-domain';
import type { Directory, Ilha, IlhaId, StaffUser, UserId } from '@viavoip/internal-domain';
import { previewOf, type ChatMessage } from '@viavoip/internal-domain';
import { can, type PermissionDenial } from '@viavoip/internal-domain';
import { own } from '@viavoip/internal-domain';
import { err, ok, type Result } from '@viavoip/internal-domain';
import type { LocalDate, TenantId } from '@viavoip/internal-domain';
import type {
  AssignIlhaSupervisorRequest,
  Bootstrap,
  ChatEvent,
  ConnectRequest,
  CreateIlhaRequest,
  CreateGroupRequest,
  LeaveGroupRequest,
  UpdateGroupRequest,
  LoginGroup,
  MarkReadRequest,
  AgentIlhaRequest,
  UnassignIlhaSupervisorRequest,
  OpenDirectRequest,
  RegisterAgentRequest,
  RegisterSupervisorRequest,
  RenameIlhaRequest,
  SendRequest,
  SetGrantRequest,
  TypingRequest,
  UserRequest,
} from '../ChatTransport';
import { ACCOUNT_DEACTIVATED, ForbiddenError } from '../errors';
import { toPersisted, type PersistedState, type ServerState, type TenantState } from './state';

/**
 * Resolvida no `connect`; as operações a revalidam contra a partição do tenant. `epoch` é a época de
 * sessão do usuário capturada no connect (ver `TenantState.sessionEpochs`): se divergir da atual, a sessão
 * foi encerrada por uma desativação e não opera mais, mesmo com a conta reativada. Sem `epoch` = ação
 * interna do servidor (entrega simulada a pares), que só exige conta ativa.
 */
export type Session = ConnectRequest & { readonly epoch?: number | undefined };

export type ServerEvent = Exclude<ChatEvent, { type: 'connection' }>;
/** Endereçada SEMPRE a um usuário do mesmo tenant do evento. */
export type Delivery = { readonly to: UserId; readonly event: ServerEvent };

export type Outcome<T> = {
  readonly result: Result<T, ForbiddenError>;
  readonly deliveries: Delivery[];
};

export type SendResult = { readonly message: ChatMessage; readonly conversation: Conversation };

export type GrantRequest = SetGrantRequest;

export type MockServerOptions = {
  now?: () => string;
  /** Gera o sufixo único dos ids de usuário e ilha cadastrados. Padrão: `crypto.randomUUID`. */
  newId?: () => string;
};


const RECENT_LIMIT = 50;

function fail(reason?: string): Outcome<never> {
  return { result: err(new ForbiddenError(reason)), deliveries: [] };
}

function succeed<T>(value: T, deliveries: Delivery[] = []): Outcome<T> {
  return { result: ok(value), deliveries };
}

/** Negação de fora do tenant nunca vaza o motivo. */
function reasonOf(denial: PermissionDenial): string | undefined {
  return denial === 'cross-tenant' || denial === 'unknown-actor' ? undefined : denial;
}

/**
 * Motivos que podem nascer de "o id não existe" OU "é de outra empresa": ficam SEM motivo (só `forbidden`),
 * para que as duas coisas sejam indistinguíveis. Os demais só aparecem com ator e alvo do mesmo tenant, e o
 * diretório do tenant já é visível a todos os usuários dele.
 */
const HIDDEN_REASONS: ReadonlySet<OpError> = new Set<OpError>([
  'cross-tenant',
  'unknown-actor',
  'unknown-ilha',
  'invalid-supervisor',
  'duplicate-user',
  'duplicate-ilha',
]);

function adminReason(error: OpError): string | undefined {
  return HIDDEN_REASONS.has(error) ? undefined : error;
}

export function participantsOf(conversation: Conversation): readonly UserId[] {
  return conversation.kind === 'direct' ? conversation.participants : conversation.members;
}

function localDate(iso: string, timeZone: string): LocalDate {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(iso)) as LocalDate;
}

function validPayload(payload: SendRequest['payload']): boolean {
  return payload.type === 'text' ? payload.text.trim() !== '' : payload.url !== '';
}

/**
 * Servidor simulado: estado PURO e síncrono, particionado por tenant. Cada operação recebe a sessão,
 * resolve o ator NO diretório da partição, valida com as mesmas funções puras do domínio
 * (`can`, `directConversation`, `applyGrant`...) e devolve o resultado mais as entregas, endereçadas
 * só a usuários do mesmo tenant. Um id de outro tenant não existe na partição: vira ForbiddenError.
 */
export class MockServer {
  private state: ServerState;
  private readonly now: () => string;
  private readonly newId: () => string;
  /** Presença efêmera (não persiste): quantas conexões cada usuário tem NESTA instância. */
  private readonly online = new Map<string, number>();

  constructor(state: ServerState, options: MockServerOptions = {}) {
    this.state = state;
    this.now = options.now ?? (() => new Date().toISOString());
    this.newId = options.newId ?? (() => crypto.randomUUID().slice(0, 8));
  }

  /** Troca o estado (outra aba escreveu); a presença local continua. */
  replaceState(state: ServerState): void {
    this.state = state;
  }

  getState(): ServerState {
    return this.state;
  }

  toPersisted(): PersistedState {
    return toPersisted(this.state);
  }

  /** Época de sessão atual do usuário (0 se nunca foi desativado ou se o tenant não existe). */
  epochOf(tenantId: TenantId, userId: UserId): number {
    const ts = this.state.get(tenantId);
    return (ts && own(ts.sessionEpochs, userId)) ?? 0;
  }

  /** A sessão ainda vale? Única regra: conta ativa E época igual à capturada no connect. */
  isLive(session: Session): boolean {
    const ts = this.state.get(session.tenantId);
    if (!ts || !canConnect(ts.directory, session.userId)) {
      return false;
    }
    return session.epoch === undefined || session.epoch === this.epochOf(session.tenantId, session.userId);
  }

  isOnline(tenantId: TenantId, userId: UserId): boolean {
    return (this.online.get(presenceKey(tenantId, userId)) ?? 0) > 0;
  }

  connect(request: ConnectRequest): Outcome<Bootstrap> {
    // Login novo: a época é a atual, não a do request.
    const resolved = this.resolve({ tenantId: request.tenantId, userId: request.userId });
    if (!resolved.ok) {
      // Só quem acerta tenant E id de uma conta desativada recebe o motivo; o resto é `forbidden`.
      const ts = this.state.get(request.tenantId);
      const known = ts ? own(ts.directory.users, request.userId) : undefined;
      return known && ts && known.tenantId === ts.tenant.id && !known.active ? fail(ACCOUNT_DEACTIVATED) : fail();
    }
    const { ts, actor } = resolved.value;
    const key = presenceKey(ts.tenant.id, actor.id);
    this.online.set(key, (this.online.get(key) ?? 0) + 1);
    ts.logins[actor.id] = { userId: actor.id, lastLoginDate: localDate(this.now(), ts.tenant.timeZone) };
    const deliveries = this.markPendingDelivered(ts, actor);
    return succeed(this.buildBootstrap(ts, actor), deliveries);
  }

  disconnect(session: Session): void {
    const key = presenceKey(session.tenantId, session.userId);
    const count = (this.online.get(key) ?? 0) - 1;
    if (count > 0) {
      this.online.set(key, count);
    } else {
      this.online.delete(key);
    }
  }

  bootstrap(session: Session): Result<Bootstrap, ForbiddenError> {
    const resolved = this.resolve(session);
    if (!resolved.ok) {
      return err(new ForbiddenError());
    }
    return ok(this.buildBootstrap(resolved.value.ts, resolved.value.actor));
  }

  /** O usuário pode agir (enviar) nessa conversa? Mesma função `can` do send. */
  authorize(session: Session, conversationId: ConversationId): Result<Conversation, ForbiddenError> {
    const resolved = this.resolve(session);
    if (!resolved.ok) {
      return err(new ForbiddenError());
    }
    const { ts, actor } = resolved.value;
    const conversation = own(ts.conversations, conversationId);
    if (!conversation) {
      return err(new ForbiddenError());
    }
    const verdict = can(actor, { type: 'conversation.send', conversation }, ts.directory);
    return verdict.ok ? ok(conversation) : err(new ForbiddenError(reasonOf(verdict.error)));
  }

  send(session: Session, request: SendRequest): Outcome<SendResult> {
    const resolved = this.resolve(session);
    if (!resolved.ok) {
      return fail();
    }
    const { ts, actor } = resolved.value;
    const conversation = own(ts.conversations, request.conversationId);
    if (!conversation) {
      return fail();
    }
    const verdict = can(actor, { type: 'conversation.send', conversation }, ts.directory);
    if (!verdict.ok) {
      return fail(reasonOf(verdict.error));
    }
    if (!validPayload(request.payload)) {
      return fail('invalid');
    }
    const list = this.messagesOf(ts, conversation.id);
    // Reenvio com o mesmo clientId é idempotente: não duplica nem reentrega.
    const existing = list.find((item) => item.authorId === actor.id && item.clientId === request.clientId);
    if (existing) {
      return succeed({ message: existing, conversation });
    }
    ts.seq += 1;
    const message = messageFromPayload(
      {
        id: `msg:${ts.tenant.id}:${String(ts.seq)}`,
        clientId: request.clientId,
        tenantId: ts.tenant.id,
        conversationId: conversation.id,
        authorId: actor.id,
        authorName: actor.name,
      },
      request.payload,
      this.now(),
      'sent',
    );
    list.push(message);
    const deliveries: Delivery[] = participantsOf(conversation).map((to) => ({
      to,
      event: { type: 'message', tenantId: ts.tenant.id, message },
    }));
    const others = participantsOf(conversation).filter((id) => id !== actor.id);
    if (others.length > 0 && others.every((id) => this.isOnline(ts.tenant.id, id))) {
      this.setStatus(list, message.id, 'delivered');
      deliveries.push(statusDelivery(ts.tenant.id, actor.id, message, 'delivered'));
    }
    return succeed({ message, conversation }, deliveries);
  }

  /** O destinatário recebeu: 'sent' vira 'delivered' nas mensagens endereçadas a ele. */
  deliverPending(session: Session): Outcome<void> {
    const resolved = this.resolve(session);
    if (!resolved.ok) {
      return fail();
    }
    return succeed(undefined, this.markPendingDelivered(resolved.value.ts, resolved.value.actor));
  }

  markRead(session: Session, request: MarkReadRequest): Outcome<void> {
    const resolved = this.resolve(session);
    if (!resolved.ok) {
      return fail();
    }
    const { ts, actor } = resolved.value;
    const conversation = own(ts.conversations, request.conversationId);
    if (!conversation) {
      return fail();
    }
    // Ler/digitar exige o mesmo que enviar: chat.use e participação (a mesma `can`).
    const verdict = can(actor, { type: 'conversation.send', conversation }, ts.directory);
    if (!verdict.ok) {
      return fail(reasonOf(verdict.error));
    }
    const list = this.messagesOf(ts, conversation.id);
    const upTo = list.findIndex((item) => item.id === request.upToMessageId);
    if (upTo === -1) {
      return fail();
    }
    const reads = this.readsOf(ts, conversation.id);
    const current = reads[actor.id] ? list.findIndex((item) => item.id === reads[actor.id]) : -1;
    if (upTo > current) {
      reads[actor.id] = request.upToMessageId;
    }
    const deliveries: Delivery[] = [];
    for (let index = 0; index <= upTo; index += 1) {
      const item = list[index];
      if (!item || item.type === 'system' || item.authorId === actor.id || item.status === 'read') {
        continue;
      }
      if (conversation.kind === 'group' && !groupMessageRead(conversation.members, item.authorId, item.id, list, reads)) continue;
      this.setStatus(list, item.id, 'read');
      deliveries.push(statusDelivery(ts.tenant.id, item.authorId, item, 'read'));
    }
    for (const to of participantsOf(conversation)) {
      deliveries.push({
        to,
        event: {
          type: 'read',
          tenantId: ts.tenant.id,
          conversationId: conversation.id,
          userId: actor.id,
          upToMessageId: request.upToMessageId,
        },
      });
    }
    return succeed(undefined, deliveries);
  }

  createGroup(session: Session, request: CreateGroupRequest): Outcome<GroupConversation> {
    const resolved = this.resolve(session);
    if (!resolved.ok) return fail();
    const { ts, actor } = resolved.value;
    const permission = can(actor, { type: 'group.manage' }, ts.directory);
    if (!permission.ok) return fail(reasonOf(permission.error));
    const members = request.memberIds.map((id) => own(ts.directory.users, id));
    if (members.some((member) => !member)) return fail();
    const id = asConversationId(`group:${ts.tenant.id}:${actor.id}:${request.clientId}`);
    const existing = own(ts.conversations, id);
    if (existing) return existing.kind === 'group' && existing.origin.kind === 'custom' && existing.origin.createdBy === actor.id ? succeed(existing) : fail();
    const result = buildGroup({ id, title: request.title, creator: actor, members: members as StaffUser[], directory: ts.directory, origin: { kind: 'custom', createdBy: actor.id }, createdAt: this.now() });
    if (!result.ok) return fail(result.error);
    const group = result.value;
    ts.conversations[id] = group;
    ts.createdAt[id] = group.createdAt;
    ts.messages[id] = [];
    const deliveries: Delivery[] = group.members.map((to) => ({ to, event: { type: 'conversation', tenantId: ts.tenant.id, conversation: group } }));
    deliveries.push(...this.systemEvent(ts, group, actor, 'created', `${actor.name} criou o grupo.`));
    return succeed(group, deliveries);
  }

  updateGroup(session: Session, request: UpdateGroupRequest): Outcome<GroupConversation> {
    const resolved = this.resolve(session);
    if (!resolved.ok) return fail();
    const { ts, actor } = resolved.value;
    const group = own(ts.conversations, request.conversationId);
    if (!group || group.kind !== 'group') return fail();
    const permission = can(actor, { type: 'group.manage', group }, ts.directory);
    if (!permission.ok) return fail(reasonOf(permission.error));
    return this.changeGroup(ts, actor, group, request);
  }

  leaveGroup(session: Session, request: LeaveGroupRequest): Outcome<GroupConversation> {
    const resolved = this.resolve(session);
    if (!resolved.ok) return fail();
    const { ts, actor } = resolved.value;
    const group = own(ts.conversations, request.conversationId);
    if (!group || group.kind !== 'group' || !group.members.includes(actor.id)) return fail();
    return this.changeGroup(ts, actor, group, { conversationId: group.id, remove: [actor.id] });
  }

  private changeGroup(ts: TenantState, actor: StaffUser, group: GroupConversation, request: UpdateGroupRequest): Outcome<GroupConversation> {
    const add = (request.add ?? []).map((id) => own(ts.directory.users, id));
    if (add.some((member) => !member) || (request.remove ?? []).some((id) => !own(ts.directory.users, id))) return fail();
    const result = reviseGroup(group, { ...(request.title !== undefined ? { title: request.title } : {}), add: add as StaffUser[], ...(request.remove ? { remove: request.remove } : {}) }, ts.directory);
    if (!result.ok) return fail(result.error);
    const removed = group.members.filter((id) => !result.value.members.includes(id));
    const formerReadLimits: Partial<Record<UserId, number>> = Object.fromEntries(
      Object.entries(group.formerReadLimits ?? {}).filter(([id]) => !result.value.members.includes(id as UserId)),
    );
    const hiddenMessageRanges = { ...group.hiddenMessageRanges };
    const messageCount = this.messagesOf(ts, group.id).length;
    for (const id of result.value.members) {
      const absenceStarted = group.formerReadLimits?.[id];
      if (absenceStarted !== undefined) {
        hiddenMessageRanges[id] = [...(hiddenMessageRanges[id] ?? []), [absenceStarted, messageCount]];
      } else if (!group.members.includes(id) && messageCount > 0) {
        hiddenMessageRanges[id] = [...(hiddenMessageRanges[id] ?? []), [0, messageCount]];
      }
    }
    for (const id of removed) formerReadLimits[id] = messageCount;
    const updated = { ...result.value, formerReadLimits, hiddenMessageRanges };
    ts.conversations[group.id] = updated;
    const deliveries: Delivery[] = [
      ...updated.members.map((to): Delivery => ({ to, event: { type: 'conversation', tenantId: ts.tenant.id, conversation: updated } })),
      ...removed.map((to): Delivery => ({ to, event: { type: 'conversation-removed', tenantId: ts.tenant.id, conversationId: group.id } })),
    ];
    if (updated.title !== group.title) deliveries.push(...this.systemEvent(ts, updated, actor, 'renamed', `${actor.name} renomeou o grupo para ${updated.title}.`));
    for (const id of updated.members.filter((id) => !group.members.includes(id))) {
      deliveries.push(...this.systemEvent(ts, updated, actor, 'added', `${actor.name} adicionou ${own(ts.directory.users, id)?.name ?? 'uma pessoa'}.`));
    }
    for (const id of removed) deliveries.push(...this.systemEvent(ts, updated, actor, 'removed', `${actor.name} removeu ${own(ts.directory.users, id)?.name ?? 'uma pessoa'}.`));
    return succeed(updated, deliveries);
  }

  openDirect(session: Session, request: OpenDirectRequest): Outcome<DirectConversation> {
    const resolved = this.resolve(session);
    if (!resolved.ok) {
      return fail();
    }
    const { ts, actor } = resolved.value;
    const target = own(ts.directory.users, request.with);
    if (!target || target.tenantId !== ts.tenant.id) {
      return fail();
    }
    const verdict = can(actor, { type: 'direct.open', with: target }, ts.directory);
    if (!verdict.ok) {
      return fail(reasonOf(verdict.error));
    }
    const built = directConversation(actor, target);
    if (!built.ok) {
      return fail();
    }
    const conversation = built.value;
    if (own(ts.conversations, conversation.id)) {
      return succeed(conversation);
    }
    ts.conversations[conversation.id] = conversation;
    ts.createdAt[conversation.id] = this.now();
    ts.messages[conversation.id] = [];
    return succeed(
      conversation,
      conversation.participants.map((to) => ({
        to,
        event: { type: 'conversation', tenantId: ts.tenant.id, conversation },
      })),
    );
  }

  setTyping(session: Session, request: TypingRequest): Outcome<void> {
    const resolved = this.resolve(session);
    if (!resolved.ok) {
      return fail();
    }
    const { ts, actor } = resolved.value;
    const conversation = own(ts.conversations, request.conversationId);
    if (!conversation) {
      return fail();
    }
    const verdict = can(actor, { type: 'conversation.send', conversation }, ts.directory);
    if (!verdict.ok) {
      return fail(reasonOf(verdict.error));
    }
    return succeed(
      undefined,
      participantsOf(conversation)
        .filter((id) => id !== actor.id)
        .map((to) => ({
          to,
          event: {
            type: 'typing',
            tenantId: ts.tenant.id,
            conversationId: conversation.id,
            userId: actor.id,
            isTyping: request.isTyping,
          },
        })),
    );
  }

  /** Usuários cadastrados por empresa, na ordem do diretório (inclui desativados: quem filtra é a tela). */
  loginGroups(): LoginGroup[] {
    return [...this.state.values()].map((ts) => ({ tenant: ts.tenant, users: Object.values(ts.directory.users) }));
  }

  /** O grantLog que o usuário da sessão pode ler (§ escopo em `visibleGrantLog`). Agente: negado. */
  grantLog(session: Session): Result<readonly GrantLogEntry[], ForbiddenError> {
    const resolved = this.resolve(session);
    if (!resolved.ok) {
      return err(new ForbiddenError());
    }
    const { ts, actor } = resolved.value;
    if (!canReadGrantLog(actor)) {
      return err(new ForbiddenError('no-capability'));
    }
    return ok(structuredClone(visibleGrantLog(ts.directory, actor, ts.grantLog)));
  }

  registerSupervisor(session: Session, request: RegisterSupervisorRequest): Outcome<StaffUser> {
    return this.mutate(session, 'directory', (state, actorId, deps) => registerSupervisor(state, actorId, request, deps), createdUser);
  }

  registerAgent(session: Session, request: RegisterAgentRequest): Outcome<StaffUser> {
    return this.mutate(session, 'directory', (state, actorId, deps) => registerAgent(state, actorId, request, deps), createdUser);
  }

  deactivateUser(session: Session, request: UserRequest): Outcome<StaffUser> {
    return this.mutate(session, 'directory', (state, actorId) => deactivateUser(state, actorId, request.userId), userAfter(request.userId));
  }

  reactivateUser(session: Session, request: UserRequest): Outcome<StaffUser> {
    return this.mutate(session, 'directory', (state, actorId) => reactivateUser(state, actorId, request.userId), userAfter(request.userId));
  }

  createIlha(session: Session, request: CreateIlhaRequest): Outcome<Ilha> {
    return this.mutate(session, 'directory', (state, actorId, deps) => createIlha(state, actorId, request, deps), createdIlha);
  }

  renameIlha(session: Session, request: RenameIlhaRequest): Outcome<Ilha> {
    return this.mutate(session, 'directory', (state, actorId) => renameIlha(state, actorId, request.ilhaId, request.name), ilhaAfter(request.ilhaId));
  }

  assignIlhaSupervisor(session: Session, request: AssignIlhaSupervisorRequest): Outcome<Ilha> {
    return this.mutate(
      session,
      'directory',
      (state, actorId) => assignIlhaSupervisor(state, actorId, request.ilhaId, request.supervisorId),
      ilhaAfter(request.ilhaId),
    );
  }

  unassignIlhaSupervisor(session: Session, request: UnassignIlhaSupervisorRequest): Outcome<Ilha> {
    return this.mutate(
      session,
      'directory',
      (state, actorId) => unassignIlhaSupervisor(state, actorId, request.ilhaId, request.supervisorId),
      ilhaAfter(request.ilhaId),
    );
  }

  addAgentToIlha(session: Session, request: AgentIlhaRequest): Outcome<StaffUser> {
    return this.mutate(session, 'directory', (state, actorId) => addAgentToIlha(state, actorId, request.userId, request.ilhaId), userAfter(request.userId));
  }

  removeAgentFromIlha(session: Session, request: AgentIlhaRequest): Outcome<StaffUser> {
    return this.mutate(session, 'directory', (state, actorId) => removeAgentFromIlha(state, actorId, request.userId, request.ilhaId), userAfter(request.userId));
  }

  /** Conceder/revogar capacidade, pelas mesmas `grantCapability`/`revokeCapability` do domínio; grava o grantLog. */
  setGrant(session: Session, request: GrantRequest): Outcome<StaffUser> {
    const operation = request.granted ? grantCapability : revokeCapability;
    return this.mutate(
      session,
      'grants',
      (state, actorId, deps) => operation(state, actorId, request.userId, request.capability, deps),
      userAfter(request.userId),
    );
  }

  /**
   * Toda escrita administrativa passa por aqui. O ator é a sessão (resolvida no diretório, ativa, do tenant);
   * a regra é a função PURA do domínio; negada = nenhum estado, log ou evento muda. `no-change` é sucesso
   * idempotente (a outra aba pode ter feito a mesma coisa): devolve o estado atual, sem log nem evento.
   */
  private mutate<T>(
    session: Session,
    kind: 'directory' | 'grants',
    operation: (state: AdminState, actorId: UserId, deps: OpDeps) => AdminResult,
    pick: (before: Directory, after: Directory) => T | undefined,
  ): Outcome<T> {
    const resolved = this.resolve(session);
    if (!resolved.ok) {
      return fail();
    }
    const { ts, actor } = resolved.value;
    const before: AdminState = { directory: ts.directory, grantLog: ts.grantLog };
    const deps: OpDeps = {
      now: this.now,
      newUserId: () => `${ts.tenant.id}-u-${this.newId()}` as UserId,
      newIlhaId: () => `${ts.tenant.id}-i-${this.newId()}` as IlhaId,
    };
    const next = operation(before, actor.id, deps);
    if (!next.ok && next.error !== 'no-change') {
      return fail(adminReason(next.error));
    }
    const after = next.ok ? next.value : before;
    const value = pick(before.directory, after.directory);
    if (value === undefined) {
      return fail();
    }
    if (!next.ok) {
      return succeed(structuredClone(value));
    }
    const islandGroups = this.prepareIslandGroups(ts, before.directory, after.directory, actor);
    if (!islandGroups.ok) return fail(islandGroups.error);
    // Desativação aceita encerra, para sempre, as sessões abertas do usuário: sobe a época dele.
    for (const user of Object.values(after.directory.users)) {
      if (!user.active && own(before.directory.users, user.id)?.active) {
        ts.sessionEpochs[user.id] = (own(ts.sessionEpochs, user.id) ?? 0) + 1;
      }
    }
    ts.directory = after.directory;
    ts.grantLog = [...after.grantLog];
    const deliveries = this.adminDeliveries(ts, kind, before, after);
    for (const { previous, group } of islandGroups.value) {
      ts.conversations[group.id] = group;
      if (!previous) {
        ts.createdAt[group.id] = group.createdAt;
        ts.messages[group.id] = [];
      }
      deliveries.push(...group.members.map((to): Delivery => ({ to, event: { type: 'conversation', tenantId: ts.tenant.id, conversation: group } })));
      const removed = previous?.members.filter((id) => !group.members.includes(id)) ?? [];
      deliveries.push(...removed.map((to): Delivery => ({ to, event: { type: 'conversation-removed', tenantId: ts.tenant.id, conversationId: group.id } })));
      if (!previous) deliveries.push(...this.systemEvent(ts, group, actor, 'created', `${actor.name} criou o grupo da ilha.`));
      else {
        for (const id of group.members.filter((member) => !previous.members.includes(member))) deliveries.push(...this.systemEvent(ts, group, actor, 'added', `${actor.name} adicionou ${own(ts.directory.users, id)?.name ?? 'uma pessoa'}.`));
        for (const id of removed) deliveries.push(...this.systemEvent(ts, group, actor, 'removed', `${actor.name} removeu ${own(ts.directory.users, id)?.name ?? 'uma pessoa'}.`));
      }
    }
    return succeed(structuredClone(value), deliveries);
  }

  private prepareIslandGroups(ts: TenantState, before: Directory, after: Directory, actor: StaffUser): Result<Array<{ previous?: GroupConversation; group: GroupConversation }>, string> {
    const changes: Array<{ previous?: GroupConversation; group: GroupConversation }> = [];
    for (const ilha of Object.values(after.ilhas)) {
      const previous = Object.values(ts.conversations).find((c): c is GroupConversation => c.kind === 'group' && c.origin.kind === 'ilha' && c.origin.ilhaId === ilha.id);
      const ids = [...new Set([...ilha.supervisorIds, ...Object.values(after.users).filter((u) => u.role === 'agent' && u.ilhaIds.includes(ilha.id)).map((u) => u.id)])];
      const oldIlha = own(before.ilhas, ilha.id);
      if (!previous && oldIlha) {
        const oldIds = [...new Set([...oldIlha.supervisorIds, ...Object.values(before.users).filter((u) => u.role === 'agent' && u.ilhaIds.includes(ilha.id)).map((u) => u.id)])];
        if (ids.length === oldIds.length && ids.every((id) => oldIds.includes(id))) continue;
      }
      if (ids.length === 0 || ids.length > 256) return err('too-many-members');
      if (!previous) {
        const members = ids.map((id) => own(after.users, id)).filter((u): u is StaffUser => u !== undefined);
        const built = buildGroup({ id: asConversationId(`group:${ts.tenant.id}:ilha:${ilha.id}`), title: ilha.name, creator: actor, members, directory: after, origin: { kind: 'ilha', ilhaId: ilha.id }, createdAt: this.now() });
        if (!built.ok) return err(built.error);
        changes.push({ group: built.value });
        continue;
      }
      if (ids.length === previous.members.length && ids.every((id) => previous.members.includes(id))) continue;
      const [first, ...rest] = ids;
      if (!first) return err('empty-members');
      const count = this.messagesOf(ts, previous.id).length;
      const removed = previous.members.filter((id) => !ids.includes(id));
      const formerReadLimits: Partial<Record<UserId, number>> = Object.fromEntries(Object.entries(previous.formerReadLimits ?? {}).filter(([id]) => !ids.includes(id as UserId)));
      const hiddenMessageRanges = { ...previous.hiddenMessageRanges };
      for (const id of ids) {
        const start = previous.formerReadLimits?.[id];
        if (start !== undefined) hiddenMessageRanges[id] = [...(hiddenMessageRanges[id] ?? []), [start, count]];
        else if (!previous.members.includes(id) && count > 0) hiddenMessageRanges[id] = [...(hiddenMessageRanges[id] ?? []), [0, count]];
      }
      for (const id of removed) formerReadLimits[id] = count;
      const formerMemberIds = [...new Set([...previous.formerMemberIds, ...removed])].filter((id) => !ids.includes(id));
      changes.push({ previous, group: { ...previous, members: [first, ...rest], formerMemberIds, formerReadLimits, hiddenMessageRanges } });
    }
    return ok(changes);
  }

  private adminDeliveries(ts: TenantState, kind: 'directory' | 'grants', before: AdminState, after: AdminState): Delivery[] {
    const tenantId = ts.tenant.id;
    const deliveries: Delivery[] = [];
    if (kind === 'directory') {
      const snapshot = structuredClone(after.directory);
      for (const user of Object.values(after.directory.users)) {
        if (canConnect(after.directory, user.id)) {
          deliveries.push({ to: user.id, event: { type: 'directory', tenantId, directory: snapshot } });
        }
      }
    } else {
      for (const changed of changedGrants(before.directory, after.directory)) {
        for (const to of Object.keys(after.directory.users) as UserId[]) {
          deliveries.push({ to, event: { type: 'grants', tenantId, userId: changed.id, grants: [...changed.grants] } });
        }
      }
    }
    // grantLog: só a quem lê, e só se o que ELE enxerga mudou (o escopo do supervisor depende do diretório).
    for (const reader of Object.values(after.directory.users)) {
      if (!canReadGrantLog(reader) || !canConnect(after.directory, reader.id)) {
        continue;
      }
      const old = visibleGrantLog(before.directory, own(before.directory.users, reader.id) ?? reader, before.grantLog);
      const now = visibleGrantLog(after.directory, reader, after.grantLog);
      if (JSON.stringify(old) !== JSON.stringify(now)) {
        deliveries.push({ to: reader.id, event: { type: 'grantLog', tenantId, entries: structuredClone(now) } });
      }
    }
    return deliveries;
  }

  private resolve(session: Session): Result<{ ts: TenantState; actor: StaffUser }, ForbiddenError> {
    const ts = this.state.get(session.tenantId);
    if (!ts) {
      return err(new ForbiddenError());
    }
    const actor = own(ts.directory.users, session.userId);
    // Cada método revalida: sessão de usuário desativado (ou removido, ou desativado e reativado) não opera mais.
    if (!actor || !this.isLive(session)) {
      return err(new ForbiddenError());
    }
    return ok({ ts, actor });
  }

  private systemEvent(ts: TenantState, group: GroupConversation, actor: StaffUser, action: SystemMessage['action'], text: string): Delivery[] {
    ts.seq += 1;
    const message: SystemMessage = { id: asMessageId(`msg:${ts.tenant.id}:${String(ts.seq)}`), tenantId: ts.tenant.id, conversationId: group.id, actorId: actor.id, timestamp: this.now(), status: 'sent', type: 'system', action, text };
    this.messagesOf(ts, group.id).push(message);
    return group.members.map((to) => ({ to, event: { type: 'message', tenantId: ts.tenant.id, message } }));
  }

  private messagesOf(ts: TenantState, id: ConversationId): ChatMessage[] {
    if (!Object.hasOwn(ts.messages, id)) {
      ts.messages[id] = [];
    }
    return ts.messages[id] ?? [];
  }

  private readsOf(ts: TenantState, id: ConversationId): Record<UserId, string> {
    if (!Object.hasOwn(ts.reads, id)) {
      ts.reads[id] = {};
    }
    return ts.reads[id] ?? {};
  }

  private setStatus(list: ChatMessage[], messageId: string, status: ChatMessage['status']): void {
    const index = list.findIndex((item) => item.id === messageId);
    const current = list[index];
    if (current) {
      list[index] = { ...current, status };
    }
  }

  private markPendingDelivered(ts: TenantState, actor: StaffUser): Delivery[] {
    const deliveries: Delivery[] = [];
    for (const conversation of Object.values(ts.conversations)) {
      if (!participantsOf(conversation).includes(actor.id)) {
        continue;
      }
      const list = this.messagesOf(ts, conversation.id);
      for (const item of [...list]) {
        if (item.type !== 'system' && item.status === 'sent' && item.authorId !== actor.id) {
          this.setStatus(list, item.id, 'delivered');
          deliveries.push(statusDelivery(ts.tenant.id, item.authorId, item, 'delivered'));
        }
      }
    }
    return deliveries;
  }

  private buildBootstrap(ts: TenantState, actor: StaffUser): Bootstrap {
    const conversations: ConversationSummary[] = [];
    const recent: Record<ConversationId, ChatMessage[]> = {};
    let unread = 0;
    for (const conversation of Object.values(ts.conversations)) {
      const active = participantsOf(conversation).includes(actor.id);
      const limit = conversation.kind === 'group' && conversation.formerMemberIds.includes(actor.id) ? conversation.formerReadLimits?.[actor.id] : undefined;
      if (!active && limit === undefined) continue;
      const all = this.messagesOf(ts, conversation.id);
      const ranges = conversation.kind === 'group' ? conversation.hiddenMessageRanges?.[actor.id] ?? [] : [];
      const list = (active ? all : all.slice(0, limit)).filter((_message, index) => !ranges.some(([start, end]) => index >= start && index < end));
      const last = list.at(-1);
      const cursor = ts.reads[conversation.id]?.[actor.id];
      const afterCursor = cursor ? list.slice(list.findIndex((item) => item.id === cursor) + 1) : list;
      const count = active ? afterCursor.filter((item) => (item.type === 'system' ? item.actorId : item.authorId) !== actor.id).length : 0;
      unread += count;
      const preview = last ? previewOf(last).split('\n')[0]?.trim() : undefined;
      conversations.push({
        id: conversation.id,
        conversation,
        ...(!active ? { readOnly: true } : {}),
        lastActivityAt: last?.timestamp ?? ts.createdAt[conversation.id] ?? this.now(),
        ...(preview ? { preview } : {}),
        unread: count,
      });
      recent[conversation.id] = list.slice(-RECENT_LIMIT);
    }
    conversations.sort((a, b) => Date.parse(b.lastActivityAt) - Date.parse(a.lastActivityAt));
    return structuredClone({ tenant: ts.tenant, me: actor, directory: ts.directory, conversations, recent, unread });
  }
}

function userAfter(id: UserId): (before: Directory, after: Directory) => StaffUser | undefined {
  return (_before, after) => own(after.users, id);
}

function ilhaAfter(id: IlhaId): (before: Directory, after: Directory) => Ilha | undefined {
  return (_before, after) => own(after.ilhas, id);
}

/** O usuário que existe depois e não existia antes. */
function createdUser(before: Directory, after: Directory): StaffUser | undefined {
  return Object.values(after.users).find((user) => !Object.hasOwn(before.users, user.id));
}

function createdIlha(before: Directory, after: Directory): Ilha | undefined {
  return Object.values(after.ilhas).find((ilha) => !Object.hasOwn(before.ilhas, ilha.id));
}

/** Quem teve os grants alterados. */
function changedGrants(before: Directory, after: Directory): StaffUser[] {
  return Object.values(after.users).filter((user) => {
    const old = own(before.users, user.id);
    return !old || old.grants.size !== user.grants.size || [...user.grants].some((grant) => !old.grants.has(grant));
  });
}

function presenceKey(tenantId: TenantId, userId: UserId): string {
  return `${tenantId}\u0000${userId}`;
}

function statusDelivery(
  tenantId: TenantId,
  to: UserId,
  message: ChatMessage,
  status: 'delivered' | 'read',
): Delivery {
  return {
    to,
    event: {
      type: 'status',
      tenantId,
      conversationId: message.conversationId,
      messageId: message.id,
      ...(message.clientId ? { clientId: message.clientId } : {}),
      status,
    },
  };
}
