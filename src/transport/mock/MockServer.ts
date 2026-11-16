import { messageFromPayload } from '../../chat/outbound';
import {
  directConversation,
  type Conversation,
  type ConversationId,
  type ConversationSummary,
  type DirectConversation,
} from '../../domain/conversation';
import {
  assignIlhaSupervisor,
  canConnect,
  createIlha,
  deactivateUser,
  grantCapability,
  moveAgent,
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
} from '../../domain/directoryOps';
import { canReadGrantLog, visibleGrantLog } from '../../domain/grantLog';
import type { Directory, Ilha, IlhaId, StaffUser, UserId } from '../../domain/identity';
import { previewOf, type ChatMessage } from '../../domain/message';
import { can, type PermissionDenial } from '../../domain/permissions';
import { own } from '../../domain/records';
import { err, ok, type Result } from '../../domain/result';
import type { LocalDate, TenantId } from '../../domain/tenant';
import type {
  AssignIlhaSupervisorRequest,
  Bootstrap,
  ChatEvent,
  ConnectRequest,
  CreateIlhaRequest,
  LoginGroup,
  MarkReadRequest,
  MoveAgentRequest,
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

/** Resolvida no `connect`; as operações a revalidam contra a partição do tenant. */
export type Session = ConnectRequest;

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

  isOnline(tenantId: TenantId, userId: UserId): boolean {
    return (this.online.get(presenceKey(tenantId, userId)) ?? 0) > 0;
  }

  connect(request: ConnectRequest): Outcome<Bootstrap> {
    const resolved = this.resolve(request);
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
      if (!item || item.authorId === actor.id || item.status === 'read') {
        continue;
      }
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

  moveAgent(session: Session, request: MoveAgentRequest): Outcome<StaffUser> {
    return this.mutate(session, 'directory', (state, actorId) => moveAgent(state, actorId, request.userId, request.ilhaId), userAfter(request.userId));
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
    ts.directory = after.directory;
    ts.grantLog = [...after.grantLog];
    return succeed(structuredClone(value), this.adminDeliveries(ts, kind, before, after));
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
    // Cada método revalida: sessão de usuário desativado (ou removido) não opera mais.
    if (!actor || !canConnect(ts.directory, actor.id)) {
      return err(new ForbiddenError());
    }
    return ok({ ts, actor });
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
        if (item.status === 'sent' && item.authorId !== actor.id) {
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
      if (!participantsOf(conversation).includes(actor.id)) {
        continue;
      }
      const list = this.messagesOf(ts, conversation.id);
      const last = list.at(-1);
      const cursor = ts.reads[conversation.id]?.[actor.id];
      const afterCursor = cursor ? list.slice(list.findIndex((item) => item.id === cursor) + 1) : list;
      const count = afterCursor.filter((item) => item.authorId !== actor.id).length;
      unread += count;
      const preview = last ? previewOf(last).split('\n')[0]?.trim() : undefined;
      conversations.push({
        id: conversation.id,
        conversation,
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
