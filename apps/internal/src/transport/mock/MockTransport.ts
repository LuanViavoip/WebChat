import type { Conversation, ConversationId, DirectConversation, GroupConversation } from '@viavoip/internal-domain';
import type { GrantLogEntry } from '@viavoip/internal-domain';
import type { Ilha, StaffUser, UserId } from '@viavoip/internal-domain';
import type { ChatMessage, MessageStatus } from '@viavoip/internal-domain';
import type { TenantId } from '@viavoip/internal-domain';
import { isSessionAborted, SessionAbortedError, UploadCanceledError, UploadFailedError } from '../abort';
import type {
  AssignIlhaSupervisorRequest,
  Bootstrap,
  ChatEvent,
  ChatEventHandler,
  ChatTransport,
  ConnectRequest,
  CreateIlhaRequest,
  CreateGroupRequest,
  UpdateGroupRequest,
  LeaveGroupRequest,
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
  TransportStatus,
  ActivityRequest,
  UploadedMedia,
  UploadRequest,
  UserRequest,
} from '../ChatTransport';
import { browserObjectUrls, type ObjectUrlFactory } from '../objectUrls';
import { MockBackend, type BackendClient } from './MockBackend';
import type { MockServer, Outcome, ServerEvent, Session } from './MockServer';

export type MockDelays = {
  connectMs: number;
  sentMs: number;
  deliveredMs: number;
  readMs: number;
  uploadChunkMs: number;
};

export type MockUploadFailure = 'never' | 'once' | 'always';

export type MockTransportOptions = {
  delays?: Partial<MockDelays>;
  now?: () => string;
  failConnect?: boolean;
  failSend?: boolean;
  failUpload?: MockUploadFailure;
  holdConnect?: boolean;
  uploadChunks?: number;
  objectUrls?: ObjectUrlFactory;
  /** Servidor compartilhado (outras instâncias/abas). Sem ele, cada transporte tem o seu, com a seed. */
  backend?: MockBackend;
  /**
   * Simula o destinatário: depois de `deliveredMs`/`readMs` ele "recebe" e "lê" a mensagem enviada.
   * Padrão `false`: quem recebe e lê é o outro usuário de verdade. Liga-se só onde não há outro humano.
   */
  simulateReceipts?: boolean;
};

const DEFAULT_DELAYS: MockDelays = {
  connectMs: 0,
  sentMs: 120,
  deliveredMs: 280,
  readMs: 520,
  uploadChunkMs: 150,
};

function sessionKey(request: ConnectRequest): string {
  return `${request.tenantId}\u0000${request.userId}`;
}

/** O cliente de UM usuário sobre o servidor simulado: latência, falhas simuladas e upload com progresso. */
export class MockTransport implements ChatTransport {
  private readonly delays: MockDelays;
  private readonly uploadChunks: number;
  private readonly objectUrls: ObjectUrlFactory;
  private readonly backend: MockBackend;
  private readonly simulateReceipts: boolean;
  failConnect: boolean;
  failSend: boolean;
  failUpload: MockUploadFailure;
  holdConnect: boolean;
  private releaseHeldConnect: (() => void) | undefined;
  private readonly handlers = new Set<ChatEventHandler>();
  private readonly connectionTimers = new Set<ReturnType<typeof setTimeout>>();
  private readonly conversationTimers = new Set<ReturnType<typeof setTimeout>>();
  private abort = new AbortController();
  private lifetime = new AbortController();
  private epoch = 0;
  private conversationEpoch = 0;
  private status: TransportStatus = 'disconnected';
  private identity: ConnectRequest | undefined;
  private identityKey = '';
  private joined = false;
  private readyGate: Promise<void> = Promise.resolve();
  private unlockReady: (() => void) | undefined;
  private readonly uploadAttempts = new Map<string, number>();
  private readonly remoteUrlsByConversation = new Map<ConversationId, string[]>();
  /** clientIds enviados por este transporte cujo eco ainda não voltou (o eco sai como 'sending'). */
  private readonly pendingEcho = new Set<string>();
  /** Mensagens próprias aguardando o 'sent' simulado: status que chegarem antes ficam retidos. */
  private readonly awaitingSent = new Map<string, ChatEvent[]>();
  private readonly client: BackendClient;

  constructor(options: MockTransportOptions = {}) {
    this.delays = { ...DEFAULT_DELAYS, ...options.delays };
    this.backend =
      options.backend ?? new MockBackend(options.now ? { now: options.now } : {});
    this.simulateReceipts = options.simulateReceipts ?? false;
    this.failConnect = options.failConnect ?? false;
    this.failSend = options.failSend ?? false;
    this.failUpload = options.failUpload ?? 'never';
    this.holdConnect = options.holdConnect ?? false;
    this.uploadChunks = options.uploadChunks ?? 5;
    this.objectUrls = options.objectUrls ?? browserObjectUrls;
    const identity = () => this.identity;
    this.client = {
      epoch: undefined,
      get tenantId(): TenantId {
        return identity()?.tenantId ?? ('' as TenantId);
      },
      get userId(): UserId {
        return identity()?.userId ?? ('' as UserId);
      },
      receive: (event) => {
        this.receive(event);
      },
    };
  }

  subscribe(handler: ChatEventHandler): () => void {
    this.handlers.add(handler);
    return () => {
      this.handlers.delete(handler);
    };
  }

  getStatus(): TransportStatus {
    return this.status;
  }

  async connect(request: ConnectRequest): Promise<Bootstrap> {
    const key = sessionKey(request);
    const sameSession = this.identityKey !== '' && this.identityKey === key;
    const releasePreviousGate = this.beginConnection();
    if (!sameSession) {
      this.resetUploadLifetime();
      this.revokeRemoteUrls();
    }
    this.leave();
    this.identity = request;
    this.identityKey = key;
    this.setStatus('connecting');
    releasePreviousGate();
    if (this.failConnect) {
      this.setStatus('error');
      this.unlockReady?.();
      throw new Error('Falha ao conectar');
    }
    const epoch = this.epoch;
    if (this.holdConnect) {
      await this.waitForRelease();
    } else if (this.delays.connectMs > 0) {
      await this.wait(this.delays.connectMs);
    } else {
      await Promise.resolve();
    }
    this.guard(epoch);
    const joined = this.backend.join(this.client, request);
    if (!joined.ok) {
      this.setStatus('error');
      this.unlockReady?.();
      throw joined.error;
    }
    this.joined = true;
    this.setStatus('connected');
    this.unlockReady?.();
    return joined.value;
  }

  releaseConnect(): void {
    const release = this.releaseHeldConnect;
    this.releaseHeldConnect = undefined;
    release?.();
  }

  disconnect(): void {
    this.abortPending(true);
    this.conversationEpoch += 1;
    this.revokeRemoteUrls();
    this.leave();
    this.pendingEcho.clear();
    this.awaitingSent.clear();
    this.setStatus('disconnected');
    this.unlockReady?.();
  }

  send(request: SendRequest): Promise<void> {
    return this.gate(() => this.dispatchSend(request));
  }

  upload(request: UploadRequest): Promise<UploadedMedia> {
    return this.gate(() => this.runUpload(request));
  }

  markRead(request: MarkReadRequest): Promise<void> {
    return this.gate(() => {
      const session = this.requireSession();
      const result = this.backend.run((server) => server.markRead(session, request));
      return result.ok ? Promise.resolve() : Promise.reject(result.error);
    });
  }

  openDirect(request: OpenDirectRequest): Promise<DirectConversation> {
    return this.gate(() => {
      const session = this.requireSession();
      const result = this.backend.run((server) => server.openDirect(session, request));
      return result.ok ? Promise.resolve(result.value) : Promise.reject(result.error);
    });
  }

  loginGroups(): readonly LoginGroup[] {
    return this.backend.query((server) => server.loginGroups());
  }

  createGroup(request: CreateGroupRequest): Promise<GroupConversation> {
    return this.admin((server, session) => server.createGroup(session, request));
  }

  updateGroup(request: UpdateGroupRequest): Promise<GroupConversation> {
    return this.admin((server, session) => server.updateGroup(session, request));
  }

  leaveGroup(request: LeaveGroupRequest): Promise<GroupConversation> {
    return this.admin((server, session) => server.leaveGroup(session, request));
  }

  registerSupervisor(request: RegisterSupervisorRequest): Promise<StaffUser> {
    return this.admin((server, session) => server.registerSupervisor(session, request));
  }

  registerAgent(request: RegisterAgentRequest): Promise<StaffUser> {
    return this.admin((server, session) => server.registerAgent(session, request));
  }

  deactivateUser(request: UserRequest): Promise<StaffUser> {
    return this.admin((server, session) => server.deactivateUser(session, request));
  }

  reactivateUser(request: UserRequest): Promise<StaffUser> {
    return this.admin((server, session) => server.reactivateUser(session, request));
  }

  createIlha(request: CreateIlhaRequest): Promise<Ilha> {
    return this.admin((server, session) => server.createIlha(session, request));
  }

  renameIlha(request: RenameIlhaRequest): Promise<Ilha> {
    return this.admin((server, session) => server.renameIlha(session, request));
  }

  assignIlhaSupervisor(request: AssignIlhaSupervisorRequest): Promise<Ilha> {
    return this.admin((server, session) => server.assignIlhaSupervisor(session, request));
  }

  unassignIlhaSupervisor(request: UnassignIlhaSupervisorRequest): Promise<Ilha> {
    return this.admin((server, session) => server.unassignIlhaSupervisor(session, request));
  }

  addAgentToIlha(request: AgentIlhaRequest): Promise<StaffUser> {
    return this.admin((server, session) => server.addAgentToIlha(session, request));
  }

  removeAgentFromIlha(request: AgentIlhaRequest): Promise<StaffUser> {
    return this.admin((server, session) => server.removeAgentFromIlha(session, request));
  }

  setGrant(request: SetGrantRequest): Promise<StaffUser> {
    return this.admin((server, session) => server.setGrant(session, request));
  }

  grantLog(): Promise<readonly GrantLogEntry[]> {
    return this.gate(() => {
      const session = this.requireSession();
      const result = this.backend.query((server) => server.grantLog(session));
      return result.ok ? Promise.resolve(result.value) : Promise.reject(result.error);
    });
  }

  /** O ator é SEMPRE `this.identity` (a sessão autenticada no `connect`): nenhum request carrega ator ou tenant. */
  private admin<T>(operation: (server: MockServer, session: Session) => Outcome<T>): Promise<T> {
    return this.gate(() => {
      const session = this.requireSession();
      const result = this.backend.run((server) => operation(server, session));
      return result.ok ? Promise.resolve(result.value) : Promise.reject(result.error);
    });
  }

  setActivity(request: ActivityRequest): void {
    if (this.status !== 'connected' || !this.identity) {
      return;
    }
    const session = this.requireSession();
    this.backend.run((server) => server.setActivity(session, request));
  }

  /** Mesma regra de antes: desconectado rejeita; em connecting espera o readyGate da conexão corrente. */
  private gate<T>(action: () => Promise<T>): Promise<T> {
    if (this.status === 'disconnected' || this.status === 'error') {
      return Promise.reject(new Error('Não conectado'));
    }
    if (this.status === 'connected') {
      return action();
    }
    const conversationEpoch = this.conversationEpoch;
    return this.whenReady().then(() => {
      this.guardConversation(conversationEpoch);
      return action();
    });
  }

  private requireSession(): Session {
    if (this.status !== 'connected' || !this.identity) {
      throw new Error('Não conectado');
    }
    return { ...this.identity, epoch: this.client.epoch };
  }

  private leave(): void {
    if (this.joined) {
      this.backend.leave(this.client);
      this.joined = false;
    }
  }

  private async runUpload(request: UploadRequest): Promise<UploadedMedia> {
    if (this.status !== 'connected' || !this.identity) {
      throw new Error('Não conectado');
    }
    const session = this.requireSession();
    const allowed = this.backend.query((server) => server.authorize(session, request.conversationId));
    if (!allowed.ok) {
      throw allowed.error;
    }
    const conversationEpoch = this.conversationEpoch;
    const total = request.file.size;
    const chunks = Math.max(1, this.uploadChunks);
    const attempt = (this.uploadAttempts.get(request.clientId) ?? 0) + 1;
    this.uploadAttempts.set(request.clientId, attempt);
    const failAt = Math.ceil(chunks / 2);
    const shouldFail =
      this.failUpload === 'always' || (this.failUpload === 'once' && attempt === 1);
    for (let step = 1; step <= chunks; step += 1) {
      await this.wait(this.delays.uploadChunkMs, request.signal, 'conversation');
      this.guardConversation(conversationEpoch);
      if (request.signal.aborted) {
        throw new UploadCanceledError();
      }
      request.onProgress({ loaded: Math.round((total * step) / chunks), total });
      if (shouldFail && step === failAt) {
        throw new UploadFailedError('Falha no upload simulado');
      }
    }
    const url = this.objectUrls.create(request.file);
    const urls = this.remoteUrlsByConversation.get(request.conversationId) ?? [];
    urls.push(url);
    this.remoteUrlsByConversation.set(request.conversationId, urls);
    return { url };
  }

  private dispatchSend(request: SendRequest): Promise<void> {
    if (this.status !== 'connected' || !this.identity) {
      return Promise.reject(new Error('Não conectado'));
    }
    if (this.failSend) {
      return Promise.reject(new Error('Falha ao enviar'));
    }
    if (request.payload.type === 'text' && !request.payload.text.trim()) {
      return Promise.resolve();
    }
    const session = this.requireSession();
    const conversationEpoch = this.conversationEpoch;
    this.pendingEcho.add(request.clientId);
    const result = this.backend.run((server) => server.send(session, request));
    const echoed = !this.pendingEcho.has(request.clientId);
    this.pendingEcho.delete(request.clientId);
    if (!result.ok) {
      return Promise.reject(result.error);
    }
    if (echoed) {
      void this.progressClient(result.value.message, result.value.conversation, conversationEpoch);
    } else {
      // Reenvio idempotente: o servidor já tinha a mensagem e não ecoou. Devolve o status atual dela
      // para o cliente nunca ficar preso em 'sending'.
      this.emitStatus(result.value.message, result.value.message.status);
    }
    return Promise.resolve();
  }

  /** Eco entregue por esta aba: autor → 'sending' (o 'sent' vem depois), demais eventos passam direto. */
  private receive(event: ServerEvent): void {
    if (!this.identity || event.tenantId !== this.identity.tenantId) {
      return;
    }
    if (event.type === 'session-ended') {
      // O servidor já tirou esta sessão da presença: avisa a UI e cai, sem chamar `leave` de novo.
      this.joined = false;
      this.emit(event);
      this.disconnect();
      return;
    }
    if (event.type === 'message' && event.message.tenantId !== this.identity.tenantId) {
      return;
    }
    if (event.type === 'conversation' && event.conversation.tenantId !== this.identity.tenantId) {
      return;
    }
    if (event.type === 'message' && event.message.authorId === this.identity.userId) {
      const clientId = event.message.clientId;
      if (clientId && this.pendingEcho.has(clientId)) {
        this.pendingEcho.delete(clientId);
        this.awaitingSent.set(event.message.id, []);
        this.emit({ ...event, message: { ...event.message, status: 'sending' } });
        return;
      }
    }
    if (event.type === 'status') {
      const held = this.awaitingSent.get(event.messageId);
      if (held) {
        held.push(event);
        return;
      }
    }
    this.emit(event);
  }

  private async progressClient(
    message: ChatMessage,
    conversation: Conversation,
    conversationEpoch: number,
  ): Promise<void> {
    const tenantId = message.tenantId;
    const peers = (conversation.kind === 'direct' ? conversation.participants : conversation.members).filter(
      (id) => id !== message.authorId,
    );
    try {
      await this.wait(this.delays.sentMs, undefined, 'conversation');
      this.guardConversation(conversationEpoch);
      this.emitSent(message);
      if (!this.simulateReceipts) {
        return;
      }
      await this.wait(this.delays.deliveredMs, undefined, 'conversation');
      this.guardConversation(conversationEpoch);
      for (const userId of peers) {
        this.backend.run((server) => server.deliverPending({ tenantId, userId }));
      }
      await this.wait(this.delays.readMs, undefined, 'conversation');
      this.guardConversation(conversationEpoch);
      for (const userId of peers) {
        this.backend.run((server) =>
          server.markRead({ tenantId, userId }, { conversationId: message.conversationId, upToMessageId: message.id }),
        );
      }
    } catch (error) {
      if (isSessionAborted(error)) {
        return;
      }
      this.awaitingSent.delete(message.id);
      this.emitStatus(message, 'error');
    }
  }

  private emitSent(message: ChatMessage): void {
    const held = this.awaitingSent.get(message.id) ?? [];
    this.awaitingSent.delete(message.id);
    this.emitStatus(message, 'sent');
    for (const event of held) {
      this.emit(event);
    }
  }

  private emitStatus(message: ChatMessage, status: MessageStatus): void {
    this.emit({
      type: 'status',
      tenantId: message.tenantId,
      conversationId: message.conversationId,
      messageId: message.id,
      status,
      ...(message.clientId ? { clientId: message.clientId } : {}),
    });
  }

  private setStatus(status: TransportStatus): void {
    this.status = status;
    this.emit({ type: 'connection', status });
  }

  private emit(event: ChatEvent): void {
    for (const handler of this.handlers) {
      handler(event);
    }
  }

  private beginConnection(): () => void {
    const releasePreviousGate = this.unlockReady ?? (() => {});
    this.abortPending(false);
    this.epoch += 1;
    this.abort = new AbortController();
    if (this.lifetime.signal.aborted) {
      this.lifetime = new AbortController();
    }
    this.readyGate = new Promise((resolve) => {
      this.unlockReady = resolve;
    });
    return releasePreviousGate;
  }

  private resetUploadLifetime(): void {
    this.lifetime.abort();
    this.uploadAttempts.clear();
    this.pendingEcho.clear();
    this.awaitingSent.clear();
    this.conversationEpoch += 1;
    this.lifetime = new AbortController();
    for (const timer of this.conversationTimers) {
      clearTimeout(timer);
    }
    this.conversationTimers.clear();
  }

  private abortPending(includeUploads: boolean): void {
    this.abort.abort();
    if (includeUploads) {
      this.lifetime.abort();
    }
    for (const timer of this.connectionTimers) {
      clearTimeout(timer);
    }
    this.connectionTimers.clear();
    if (includeUploads) {
      for (const timer of this.conversationTimers) {
        clearTimeout(timer);
      }
      this.conversationTimers.clear();
    }
  }

  private revokeRemoteUrls(): void {
    for (const conversationId of [...this.remoteUrlsByConversation.keys()]) {
      this.revokeConversationUrls(conversationId);
    }
  }

  private revokeConversationUrls(conversationId: ConversationId): void {
    const urls = this.remoteUrlsByConversation.get(conversationId);
    if (!urls) {
      return;
    }
    for (const url of urls) {
      this.objectUrls.revoke(url);
    }
    this.remoteUrlsByConversation.delete(conversationId);
  }

  private whenReady(): Promise<void> {
    if (this.status === 'connected') {
      return Promise.resolve();
    }
    if (this.status === 'connecting') {
      return this.readyGate.then(() => this.whenReady());
    }
    return Promise.reject(new Error('Não conectado'));
  }

  private guard(epoch: number): void {
    if (epoch !== this.epoch || this.abort.signal.aborted) {
      throw new SessionAbortedError();
    }
  }

  private guardConversation(conversationEpoch: number): void {
    if (conversationEpoch !== this.conversationEpoch || this.lifetime.signal.aborted) {
      throw new SessionAbortedError();
    }
  }

  private waitForRelease(): Promise<void> {
    const sessionSignal = this.abort.signal;
    if (sessionSignal.aborted) {
      return Promise.reject(new SessionAbortedError());
    }
    return new Promise((resolve, reject) => {
      const cleanup = () => {
        sessionSignal.removeEventListener('abort', onAbort);
        this.releaseHeldConnect = undefined;
      };
      const onAbort = () => {
        cleanup();
        reject(new SessionAbortedError());
      };
      this.releaseHeldConnect = () => {
        cleanup();
        resolve();
      };
      sessionSignal.addEventListener('abort', onAbort, { once: true });
    });
  }

  private wait(
    ms: number,
    extra?: AbortSignal,
    scope: 'connection' | 'conversation' = 'connection',
  ): Promise<void> {
    const sessionSignal = scope === 'conversation' ? this.lifetime.signal : this.abort.signal;
    const timers = scope === 'conversation' ? this.conversationTimers : this.connectionTimers;
    if (sessionSignal.aborted) {
      return Promise.reject(new SessionAbortedError());
    }
    if (extra?.aborted) {
      return Promise.reject(new UploadCanceledError());
    }
    if (ms <= 0) {
      return Promise.resolve();
    }
    return new Promise((resolve, reject) => {
      const cleanup = () => {
        clearTimeout(timer);
        timers.delete(timer);
        sessionSignal.removeEventListener('abort', onSessionAbort);
        extra?.removeEventListener('abort', onCancel);
      };
      const onSessionAbort = () => {
        cleanup();
        reject(new SessionAbortedError());
      };
      const onCancel = () => {
        cleanup();
        reject(new UploadCanceledError());
      };
      const timer = setTimeout(() => {
        cleanup();
        resolve();
      }, ms);
      timers.add(timer);
      sessionSignal.addEventListener('abort', onSessionAbort, { once: true });
      extra?.addEventListener('abort', onCancel, { once: true });
    });
  }
}
