import type { UserId } from '../../domain/identity';
import type { Result } from '../../domain/result';
import type { TenantId } from '../../domain/tenant';
import type { ConnectRequest } from '../ChatTransport';
import type { ForbiddenError } from '../errors';
import { own } from '../../domain/records';
import { MockServer, participantsOf, type Delivery, type Outcome, type ServerEvent } from './MockServer';
import { MemoryMockStore, type MockStore } from './MockStore';
import { createSeedState } from './seed';
import { fromPersisted } from './state';
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
    }
    return result;
  }

  leave(client: BackendClient): void {
    if (this.clients.delete(client)) {
      this.server.disconnect({ tenantId: client.tenantId, userId: client.userId });
    }
  }

  close(): void {
    this.unsubscribeTabs();
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

  private isCoherent(delivery: unknown): boolean {
    if (typeof delivery !== 'object' || delivery === null) {
      return false;
    }
    const { to, event } = delivery as Partial<Delivery>;
    if (typeof to !== 'string' || typeof event !== 'object' || (event as unknown) === null) {
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
        if (!isRecord(event.message) || event.message.tenantId !== event.tenantId) {
          return false;
        }
        conversationId = event.message.conversationId;
        if (!(ts.messages[event.message.conversationId] ?? []).some((item) => item.id === event.message.id)) {
          return false;
        }
        break;
      case 'conversation':
        if (!isRecord(event.conversation) || event.conversation.tenantId !== event.tenantId) {
          return false;
        }
        conversationId = event.conversation.id;
        break;
      case 'status':
      case 'typing':
      case 'read':
        conversationId = event.conversationId;
        break;
      case 'grants':
        return own(ts.directory.users, event.userId) !== undefined;
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
    const accepted = (Array.isArray(deliveries) ? deliveries : []).filter((delivery) => this.isCoherent(delivery));
    deliveries = accepted;
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
