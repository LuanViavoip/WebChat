import { messageFromPayload } from '../../chat/outbound';
import type { Capability } from '../../domain/capabilities';
import {
  directConversation,
  type Conversation,
  type ConversationId,
  type ConversationSummary,
  type DirectConversation,
} from '../../domain/conversation';
import { applyGrant, applyRevoke } from '../../domain/directoryOps';
import type { StaffUser, UserId } from '../../domain/identity';
import { previewOf, type ChatMessage } from '../../domain/message';
import { can, type PermissionDenial } from '../../domain/permissions';
import { own } from '../../domain/records';
import { err, ok, type Result } from '../../domain/result';
import type { LocalDate, TenantId } from '../../domain/tenant';
import type {
  Bootstrap,
  ChatEvent,
  ConnectRequest,
  MarkReadRequest,
  OpenDirectRequest,
  SendRequest,
  TypingRequest,
} from '../ChatTransport';
import { ForbiddenError } from '../errors';
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

export type GrantRequest = { userId: UserId; capability: Capability; granted: boolean };

export type MockServerOptions = { now?: () => string };

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
  /** Presença efêmera (não persiste): quantas conexões cada usuário tem NESTA instância. */
  private readonly online = new Map<string, number>();

  constructor(state: ServerState, options: MockServerOptions = {}) {
    this.state = state;
    this.now = options.now ?? (() => new Date().toISOString());
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
      return fail();
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

  /** Conceder/revogar capacidade, pelas mesmas `applyGrant`/`applyRevoke` do domínio (canGrant/canRevoke). */
  setGrant(session: Session, request: GrantRequest): Outcome<StaffUser> {
    const resolved = this.resolve(session);
    if (!resolved.ok) {
      return fail();
    }
    const { ts, actor } = resolved.value;
    const apply = request.granted ? applyGrant : applyRevoke;
    const next = apply(ts.directory, actor.id, request.userId, request.capability);
    if (!next.ok) {
      const denial = next.error;
      return fail(denial === 'unknown-target' || denial === 'unknown-actor' || denial === 'cross-tenant' ? undefined : denial);
    }
    ts.directory = next.value;
    const target = own(ts.directory.users, request.userId);
    if (!target) {
      return fail();
    }
    const deliveries: Delivery[] = Object.keys(ts.directory.users).map((to) => ({
      to: to as UserId,
      event: { type: 'grants', tenantId: ts.tenant.id, userId: target.id, grants: [...target.grants] },
    }));
    return succeed(target, deliveries);
  }

  private resolve(session: Session): Result<{ ts: TenantState; actor: StaffUser }, ForbiddenError> {
    const ts = this.state.get(session.tenantId);
    if (!ts) {
      return err(new ForbiddenError());
    }
    const actor = own(ts.directory.users, session.userId);
    if (!actor || actor.tenantId !== ts.tenant.id || !actor.active) {
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
