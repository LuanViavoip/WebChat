import type { UserId } from '../../domain/identity';
import type { Result } from '../../domain/result';
import type { TenantId } from '../../domain/tenant';
import type { ConnectRequest } from '../ChatTransport';
import type { ForbiddenError } from '../errors';
import { own } from '../../domain/records';
import { MockServer, participantsOf, type Delivery, type Outcome, type ServerEvent } from './MockServer';
import { MemoryMockStore, type MockStore } from './MockStore';
import { createSeedState } from './seed';
import { fromPersisted, type PersistedState } from './state';
import { noopTabSync, type TabSync } from './TabSync';

/** Um cliente conectado NESTA aba (um MockTransport). */
export interface BackendClient {
  readonly tenantId: TenantId;
  readonly userId: UserId;
  receive(event: ServerEvent): void;
}

export type MockBackendOptions = {
  store?: MockStore;
  tabSync?: TabSync;
  now?: () => string;
};

/**
 * Cola por aba: o MockServer (estado puro) + o store compartilhado + o TabSync.
 * A aba que escreve persiste e entrega aos seus clientes; as outras abas recarregam o estado
 * e entregam aos clientes delas. Cada operação relê o store antes de agir (outra aba pode ter escrito).
 */
export class MockBackend {
  readonly server: MockServer;
  private readonly store: MockStore;
  private readonly tabSync: TabSync;
  private readonly clients = new Set<BackendClient>();
  private readonly snapshots = new Map<BackendClient, PersistedState>();
  private reconciliationTimer: ReturnType<typeof setInterval> | undefined;
  private readonly unsubscribeTabs: () => void;
  /** `false` depois de uma falha de gravação: opera só em memória e nunca relê o storage (que ficou velho). */
  private persistent = true;

  constructor(options: MockBackendOptions = {}) {
    this.store = options.store ?? new MemoryMockStore();
    this.tabSync = options.tabSync ?? noopTabSync;
    const now = options.now ?? (() => new Date().toISOString());
    const loaded = fromPersisted(this.store.load());
    this.server = new MockServer(loaded ?? createSeedState(now()), { now });
    if (!loaded) {
      this.persistent = this.store.save(this.server.toPersisted());
    }
    this.unsubscribeTabs = this.tabSync.subscribe((message) => {
      this.onRemote(message.deliveries);
    });
  }

  /** Executa uma operação de escrita: relê, aplica, persiste, entrega aqui e avisa as outras abas. */
  run<T>(operation: (server: MockServer) => Outcome<T>): Result<T, ForbiddenError> {
    this.sync();
    const outcome = operation(this.server);
    if (outcome.result.ok && this.persistent) {
      this.persistent = this.store.save(this.server.toPersisted());
    }
    this.publish(outcome.deliveries);
    return outcome.result;
  }

  /** Leitura (sem persistir), já com o estado mais recente. */
  query<T>(operation: (server: MockServer) => T): T {
    this.sync();
    return operation(this.server);
  }

  /** Entra: registra a presença, entrega o que estava pendente e devolve o Bootstrap. */
  join(client: BackendClient, request: ConnectRequest) {
    const result = this.run((server) => server.connect(request));
    if (result.ok) {
      this.clients.add(client);
      this.snapshots.set(client, this.server.toPersisted());
      if (this.tabSync !== noopTabSync) {
        this.reconciliationTimer ??= setInterval(() => { this.reconcile(); }, 500);
      }
    }
    return result;
  }

  leave(client: BackendClient): void {
    if (this.clients.delete(client)) {
      this.snapshots.delete(client);
      this.server.disconnect({ tenantId: client.tenantId, userId: client.userId });
      if (this.clients.size === 0 && this.reconciliationTimer !== undefined) {
        clearInterval(this.reconciliationTimer);
        this.reconciliationTimer = undefined;
      }
    }
  }

  close(): void {
    this.unsubscribeTabs();
    if (this.reconciliationTimer !== undefined) clearInterval(this.reconciliationTimer);
    this.reconciliationTimer = undefined;
    this.snapshots.clear();
    this.tabSync.close();
  }

  private sync(): void {
    if (!this.persistent) {
      return;
    }
    const state = fromPersisted(this.store.load());
    if (state) {
      this.server.replaceState(state);
    }
  }

  /** Recupera mudanças persistidas mesmo se um aviso entre abas se perdeu ou chegou cedo demais. */
  private reconcile(): void {
    this.sync();
    const current = this.server.getState();
    const snapshot = this.server.toPersisted();
    for (const client of [...this.clients]) {
      const previous = fromPersisted(this.snapshots.get(client));
      const before = previous?.get(client.tenantId);
      const tenant = current.get(client.tenantId);
      this.snapshots.set(client, snapshot);
      if (!before || !tenant || !own(tenant.directory.users, client.userId)?.active) continue;
      const deliveries: Delivery[] = [];
      for (const user of Object.values(tenant.directory.users)) {
        const old = own(before.directory.users, user.id);
        if (old && (old.grants.size !== user.grants.size || [...user.grants].some((grant) => !old.grants.has(grant)))) {
          deliveries.push({ to: client.userId, event: { type: 'grants', tenantId: client.tenantId, userId: user.id, grants: [...user.grants] } });
        }
      }
      let receivedMessage = false;
      for (const conversation of Object.values(tenant.conversations)) {
        if (!participantsOf(conversation).includes(client.userId)) continue;
        if (!own(before.conversations, conversation.id)) {
          deliveries.push({ to: client.userId, event: { type: 'conversation', tenantId: client.tenantId, conversation } });
        }
        const oldMessages = own(before.messages, conversation.id) ?? [];
        for (const message of own(tenant.messages, conversation.id) ?? []) {
          const old = oldMessages.find((item) => item.id === message.id);
          if (!old) {
            deliveries.push({ to: client.userId, event: { type: 'message', tenantId: client.tenantId, message } });
            receivedMessage ||= message.authorId !== client.userId;
          }
          if (message.authorId === client.userId && old?.status !== message.status &&
                     (message.status === 'delivered' || message.status === 'read')) {
            deliveries.push({ to: client.userId, event: { type: 'status', tenantId: client.tenantId, conversationId: conversation.id, messageId: message.id, ...(message.clientId ? { clientId: message.clientId } : {}), status: message.status } });
          }
        }
        const oldReads = own(before.reads, conversation.id);
        for (const [userId, cursor] of Object.entries(own(tenant.reads, conversation.id) ?? {})) {
          if (own(oldReads ?? {}, userId) !== cursor) {
            deliveries.push({ to: client.userId, event: { type: 'read', tenantId: client.tenantId, conversationId: conversation.id, userId: userId as UserId, upToMessageId: cursor } });
          }
        }
      }
      this.dispatch(deliveries);
      if (receivedMessage && this.clients.has(client)) {
        this.run((server) => server.deliverPending({ tenantId: client.tenantId, userId: client.userId }));
      }
    }
  }

  private isCoherent(delivery: unknown): delivery is Delivery {
    if (typeof delivery !== 'object' || delivery === null) {
      return false;
    }
    const { to, event } = delivery as Partial<Delivery>;
    if (typeof to !== 'string' || typeof event !== 'object' || (event as unknown) === null || typeof event.tenantId !== 'string') {
      return false;
    }
    const ts = this.server.getState().get(event.tenantId);
    const user = ts ? own(ts.directory.users, to) : undefined;
    if (!ts || !user || !user.active || user.tenantId !== ts.tenant.id) {
      return false;
    }
    let conversationId: string | undefined;
    switch (event.type) {
      case 'message':
        if (!isRecord(event.message) || event.message.tenantId !== event.tenantId ||
            typeof event.message.conversationId !== 'string' || typeof event.message.id !== 'string') {
          return false;
        }
        conversationId = event.message.conversationId;
        if (!(own(ts.messages, event.message.conversationId) ?? []).some((item) => item.id === event.message.id)) {
          return false;
        }
        break;
      case 'conversation':
        if (!isRecord(event.conversation) || event.conversation.tenantId !== event.tenantId || typeof event.conversation.id !== 'string') {
          return false;
        }
        conversationId = event.conversation.id;
        break;
      case 'status': {
        if (typeof event.conversationId !== 'string' || typeof event.messageId !== 'string') return false;
        const message = (own(ts.messages, event.conversationId) ?? []).find((item) => item.id === event.messageId);
        const rank = { sending: 0, sent: 1, delivered: 2, read: 3, error: -1 };
        if (!message || message.authorId !== to || event.clientId !== message.clientId ||
            (event.status !== 'delivered' && event.status !== 'read') ||
            !Object.hasOwn(rank, message.status) || rank[message.status] < rank[event.status]) {
          return false;
        }
        conversationId = event.conversationId;
        break;
      }
      case 'read': {
        if (typeof event.conversationId !== 'string' || typeof event.userId !== 'string' ||
            typeof event.upToMessageId !== 'string') return false;
        const conversation = own(ts.conversations, event.conversationId);
        const reads = own(ts.reads, event.conversationId);
        if (!conversation || !participantsOf(conversation).includes(event.userId) ||
            !reads || own(reads, event.userId) !== event.upToMessageId) {
          return false;
        }
        conversationId = event.conversationId;
        break;
      }
      case 'typing': {
        if (typeof event.conversationId !== 'string' || typeof event.userId !== 'string') return false;
        const conversation = own(ts.conversations, event.conversationId);
        if (!conversation || !participantsOf(conversation).includes(event.userId) ||
            event.userId === to || typeof event.isTyping !== 'boolean' || !own(ts.directory.users, event.userId)?.active) {
          return false;
        }
        conversationId = event.conversationId;
        break;
      }
      case 'grants': {
        if (typeof event.userId !== 'string' || !Array.isArray(event.grants) ||
            !event.grants.every((grant) => typeof grant === 'string')) return false;
        const target = own(ts.directory.users, event.userId);
        const announced = new Set<string>(event.grants);
        return !!target && announced.size === event.grants.length && announced.size === target.grants.size &&
          [...target.grants].every((grant) => announced.has(grant));
      }
      default:
        return false;
    }
    const conversation = own(ts.conversations, conversationId as never);
    return conversation !== undefined && participantsOf(conversation).includes(to);
  }

  private publish(deliveries: Delivery[]): void {
    if (deliveries.length === 0) {
      return;
    }
    this.dispatch(deliveries);
    this.tabSync.post({ kind: 'deliveries', deliveries });
  }

  private dispatch(deliveries: readonly Delivery[]): void {
    for (const delivery of deliveries) {
      for (const client of [...this.clients]) {
        if (client.userId === delivery.to && client.tenantId === delivery.event.tenantId) {
          client.receive(delivery.event);
        }
      }
    }
  }

  private onRemote(received: readonly Delivery[]): void {
    let deliveries = received;
    this.sync();
    // O canal é entrada não confiável: só entrega o que fecha com o estado do tenant.
    const incoming: readonly unknown[] = Array.isArray(deliveries) ? deliveries : [];
    const accepted = incoming.filter((delivery): delivery is Delivery => this.isCoherent(delivery));
    deliveries = accepted.flatMap((delivery): Delivery[] => {
      const event = delivery.event;
      const tenant = this.server.getState().get(event.tenantId);
      if (!tenant) return [];
      switch (event.type) {
        case 'message': {
          const message = own(tenant.messages, event.message.conversationId)?.find((item) => item.id === event.message.id);
          return message ? [{ to: delivery.to, event: { type: 'message', tenantId: tenant.tenant.id, message } }] : [];
        }
        case 'conversation': {
          const conversation = own(tenant.conversations, event.conversation.id);
          return conversation ? [{ to: delivery.to, event: { type: 'conversation', tenantId: tenant.tenant.id, conversation } }] : [];
        }
        case 'grants': {
          const user = own(tenant.directory.users, event.userId);
          return user ? [{ to: delivery.to, event: { type: 'grants', tenantId: tenant.tenant.id, userId: user.id, grants: [...user.grants] } }] : [];
        }
        case 'status': {
          const message = own(tenant.messages, event.conversationId)?.find((item) => item.id === event.messageId);
          if (!message || (message.status !== 'delivered' && message.status !== 'read')) return [];
          return [{ to: delivery.to, event: { type: 'status', tenantId: tenant.tenant.id, conversationId: message.conversationId, messageId: message.id, ...(message.clientId ? { clientId: message.clientId } : {}), status: message.status } }];
        }
        case 'read': {
          const cursor = own(tenant.reads, event.conversationId);
          const upToMessageId = cursor && own(cursor, event.userId);
          return upToMessageId ? [{ to: delivery.to, event: { type: 'read', tenantId: tenant.tenant.id, conversationId: event.conversationId, userId: event.userId, upToMessageId } }] : [];
        }
        case 'typing':
          return [delivery];
      }
    });
    this.dispatch(deliveries);
    // Quem estava conectado aqui e recebeu mensagem nova: marca entregue (e avisa o autor).
    const receivers = new Set<string>();
    for (const { to, event } of deliveries) {
      if (event.type === 'message' && event.message.authorId !== to && this.server.isOnline(event.tenantId, to)) {
        receivers.add(`${event.tenantId}\u0000${to}`);
      }
    }
    for (const key of receivers) {
      const [tenantId, userId] = key.split('\u0000') as [TenantId, UserId];
      this.run((server) => server.deliverPending({ tenantId, userId }));
    }
  }
}

function isRecord(value: unknown): value is object {
  return typeof value === 'object' && value !== null;
}
