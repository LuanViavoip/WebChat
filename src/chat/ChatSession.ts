import { type ValidAttachment } from '../domain/attachment';
import type { Conversation, ConversationId, ConversationSummary } from '../domain/conversation';
import type { Directory, StaffUser, UserId } from '../domain/identity';
import { previewOf, type ChatMessage, type MessageStatus } from '../domain/message';
import type { Tenant } from '../domain/tenant';
import { isSessionAborted, isUploadCanceled } from '../transport/abort';
import type {
  Bootstrap,
  ChatEvent,
  ChatTransport,
  ConnectRequest,
  OutboundPayload,
  TransportStatus,
} from '../transport/ChatTransport';
import { DEFAULT_SESSION } from '../transport/mock/seed';
import { browserObjectUrls, type ObjectUrlFactory } from '../transport/objectUrls';
import { IdAliasIndex } from './idAlias';
import {
  messageFromPayload,
  normalizePayload,
  payloadForAttachment,
  payloadFromMessage,
  type MessageOrigin,
} from './outbound';
import { DEFAULT_PENDING_LIMIT, DEFAULT_PENDING_TTL_MS, PendingStatusMap } from './pendingStatus';
import { mergeStatus } from './statusRank';
import { beginUpload, nextUpload, type UploadEntry, type UploadView } from './uploads';

export type TypingState = {
  isTyping: boolean;
  actorName: string;
};

/** O que a UI enxerga de uma conversa. Nada aqui é compartilhado entre conversas. */
export type ThreadState = {
  conversation: Conversation;
  messages: ChatMessage[];
  typing: TypingState;
  /** Uploads em andamento ou falhos, por clientId, só desta conversa. */
  uploads: Readonly<Record<string, UploadView>>;
  unread: number;
  /** ISO 8601. */
  lastActivityAt: string;
  preview?: string;
};

export type ChatSessionState = {
  connection: TransportStatus;
  error: string | null;
  /** A conversa a que o erro pertence (falha de envio); `null` = erro da sessão (conexão, abrir conversa). */
  errorConversationId: ConversationId | null;
  tenant: Tenant | null;
  me: StaffUser | null;
  directory: Directory | null;
  conversations: Readonly<Record<ConversationId, ThreadState>>;
  /** As conversas da sessão, da mais recente para a mais antiga (a seção fica a cargo da UI). */
  summaries: readonly ConversationSummary[];
  activeConversationId: ConversationId | null;
};

export type ChatSessionListener = (state: ChatSessionState) => void;

export type ChatSessionOptions = {
  /** Quem conecta. Até a tela "Entrar como" (Bloco 4), o padrão é o usuário da seed. */
  identity?: ConnectRequest;
  createId?: () => string;
  now?: () => string;
  pendingLimit?: number;
  pendingTtlMs?: number;
  objectUrls?: ObjectUrlFactory;
};

const IDLE_TYPING: TypingState = { isTyping: false, actorName: '' };

type Thread = {
  conversation: Conversation;
  messages: ChatMessage[];
  typing: TypingState;
  unread: number;
  lastActivityAt: string;
  preview: string | undefined;
  readonly aliases: IdAliasIndex;
  readonly pendingStatus: PendingStatusMap;
  readonly uploads: Map<string, UploadEntry>;
  readonly controllers: Map<string, AbortController>;
};

export class ChatSession {
  private connection: TransportStatus = 'disconnected';
  private error: string | null = null;
  private errorConversationId: ConversationId | null = null;
  private generation = 0;
  private identity: ConnectRequest;
  private tenant: Tenant | null = null;
  private me: StaffUser | null = null;
  private directory: Directory | null = null;
  private activeConversationId: ConversationId | null = null;
  private threads = new Map<ConversationId, Thread>();
  private readonly listeners = new Set<ChatSessionListener>();
  private unsubscribeTransport: (() => void) | undefined;
  private readonly createId: () => string;
  private readonly now: () => string;
  private readonly objectUrls: ObjectUrlFactory;
  private readonly pendingLimit: number;
  private readonly pendingTtlMs: number;

  constructor(
    private readonly transport: ChatTransport,
    options: ChatSessionOptions = {},
  ) {
    this.identity = options.identity ?? DEFAULT_SESSION;
    this.createId = options.createId ?? (() => crypto.randomUUID());
    this.now = options.now ?? (() => new Date().toISOString());
    this.objectUrls = options.objectUrls ?? browserObjectUrls;
    this.pendingLimit = options.pendingLimit ?? DEFAULT_PENDING_LIMIT;
    this.pendingTtlMs = options.pendingTtlMs ?? DEFAULT_PENDING_TTL_MS;
  }

  subscribe(listener: ChatSessionListener): () => void {
    this.listeners.add(listener);
    listener(this.snapshot());
    return () => {
      this.listeners.delete(listener);
    };
  }

  getState(): ChatSessionState {
    return this.snapshot();
  }

  /** Abre a conexão do usuário (uma por usuário) e recomeça do zero com o Bootstrap. */
  async start(identity?: ConnectRequest): Promise<void> {
    this.generation += 1;
    const generation = this.generation;
    if (identity) {
      this.identity = identity;
    }
    this.clearAllUploads();
    this.threads = new Map();
    this.tenant = null;
    this.me = null;
    this.directory = null;
    this.activeConversationId = null;
    this.clearError();
    this.connection = 'disconnected';
    this.bindTransport(generation);
    this.emit();
    await this.openConnection(generation, true);
  }

  async reconnect(): Promise<void> {
    this.generation += 1;
    const generation = this.generation;
    this.clearError();
    for (const thread of this.threads.values()) {
      thread.typing = IDLE_TYPING;
    }
    this.bindTransport(generation);
    if (this.transport.getStatus() === 'connected') {
      this.connection = 'connected';
      this.emit();
      return;
    }
    this.connection = 'disconnected';
    this.emit();
    await this.openConnection(generation, false);
  }

  private clearError(): void {
    this.error = null;
    this.errorConversationId = null;
  }

  stop(): void {
    this.generation += 1;
    this.clearAllUploads();
    this.unsubscribeTransport?.();
    this.unsubscribeTransport = undefined;
    this.transport.disconnect();
  }

  /**
   * Torna a conversa ativa e marca como lidas as mensagens de outros. Antes do Bootstrap fica pendente.
   * `null` = nenhuma conversa à vista (ex.: lista no mobile): as mensagens novas ficam não lidas.
   */
  selectConversation(conversationId: ConversationId | null): void {
    if (conversationId === null) {
      this.activeConversationId = null;
      this.emit();
      return;
    }
    const thread = this.threads.get(conversationId);
    if (!thread && this.me) {
      return;
    }
    this.activeConversationId = conversationId;
    if (thread && thread.unread > 0) {
      this.markReadUpTo(conversationId, thread);
    }
    this.emit();
  }

  /** Abre (ou reaproveita) a direta com o colega e a seleciona. Devolve o id, ou `undefined` se falhar. */
  async openDirect(userId: UserId): Promise<ConversationId | undefined> {
    const generation = this.generation;
    try {
      const conversation = await this.transport.openDirect({ with: userId });
      if (generation !== this.generation) {
        return undefined;
      }
      if (!this.ensureThread(conversation)) {
        this.error = 'Não foi possível abrir a conversa.';
        this.emit();
        return undefined;
      }
      this.selectConversation(conversation.id);
      return conversation.id;
    } catch (error) {
      if (generation !== this.generation || isSessionAborted(error)) {
        return undefined;
      }
      this.error = errorMessage(error, 'Não foi possível abrir a conversa.');
      this.emit();
      return undefined;
    }
  }

  setTyping(conversationId: ConversationId, isTyping: boolean): void {
    if (!this.threads.has(conversationId)) {
      return;
    }
    this.transport.setTyping({ conversationId, isTyping });
  }

  async send(conversationId: ConversationId, input: string | OutboundPayload): Promise<void> {
    const thread = this.threads.get(conversationId);
    if (!thread) {
      return;
    }
    const normalized = normalizePayload(typeof input === 'string' ? { type: 'text', text: input } : input);
    if (!normalized) {
      return;
    }
    const generation = this.generation;
    const clientId = this.createId();
    thread.aliases.link(clientId, clientId);
    this.upsertMessage(thread, messageFromPayload(this.origin(conversationId, clientId), normalized, this.now(), 'sending'));
    this.emit();
    await this.dispatchSend(conversationId, thread, clientId, normalized, generation);
  }

  async sendAttachment(
    conversationId: ConversationId,
    attachment: ValidAttachment,
    caption?: string,
  ): Promise<void> {
    const thread = this.threads.get(conversationId);
    if (!thread) {
      return;
    }
    const clientId = this.createId();
    const previewUrl = this.objectUrls.create(attachment.file);
    const payload = payloadForAttachment(attachment, previewUrl, caption);
    thread.aliases.link(clientId, clientId);
    this.upsertMessage(thread, messageFromPayload(this.origin(conversationId, clientId), payload, this.now(), 'sending'));
    thread.uploads.set(clientId, beginUpload(attachment, caption, previewUrl));
    this.emit();
    await this.runUpload(conversationId, thread, clientId);
  }

  cancelUpload(conversationId: ConversationId, messageId: string): void {
    const thread = this.threads.get(conversationId);
    if (!thread) {
      return;
    }
    const key = this.uploadKey(thread, messageId);
    if (!key) {
      return;
    }
    const entry = thread.uploads.get(key);
    if (!entry) {
      return;
    }
    const next = nextUpload(entry, { type: 'cancel' });
    if (next !== 'removed' && next === entry) {
      return;
    }
    thread.controllers.get(key)?.abort();
    thread.controllers.delete(key);
    thread.uploads.delete(key);
    this.objectUrls.revoke(entry.previewUrl);
    thread.messages = thread.messages.filter((message) => !this.matchesId(thread, message, key));
    this.emit();
  }

  async retry(conversationId: ConversationId, messageId: string): Promise<void> {
    const thread = this.threads.get(conversationId);
    if (!thread) {
      return;
    }
    const uploadKey = this.uploadKey(thread, messageId);
    const upload = uploadKey ? thread.uploads.get(uploadKey) : undefined;
    if (upload?.view.phase === 'failed' && uploadKey) {
      const next = nextUpload(upload, { type: 'retry' });
      if (next === 'removed') {
        return;
      }
      thread.uploads.set(uploadKey, next);
      this.applyStatus(thread, uploadKey, 'sending', true);
      this.emit();
      await this.runUpload(conversationId, thread, uploadKey);
      return;
    }
    const message = this.findMessage(thread, messageId);
    if (!message || message.status !== 'error') {
      return;
    }
    const generation = this.generation;
    this.clearError();
    this.applyStatus(thread, message.id, 'sending', true);
    this.emit();
    const clientId = message.clientId ?? message.id;
    await this.dispatchSend(conversationId, thread, clientId, payloadFromMessage(message), generation);
  }

  private async runUpload(conversationId: ConversationId, thread: Thread, clientId: string): Promise<void> {
    const entry = thread.uploads.get(clientId);
    if (!entry) {
      return;
    }
    const generation = this.generation;
    const attempt = entry.attempt;
    const controller = new AbortController();
    thread.controllers.set(clientId, controller);
    const { attachment, caption } = entry;
    try {
      const { url } = await this.transport.upload({
        conversationId,
        clientId,
        file: attachment.file,
        fileName: attachment.fileName,
        mimeType: attachment.mimeType,
        signal: controller.signal,
        onProgress: ({ loaded }) => {
          this.applyUploadProgress(thread, clientId, attempt, loaded);
        },
      });
      const current = thread.uploads.get(clientId);
      if (!current || current.attempt !== attempt) {
        return;
      }
      const succeeded = nextUpload(current, { type: 'succeed', attempt });
      if (succeeded !== 'removed') {
        return;
      }
      thread.uploads.delete(clientId);
      thread.controllers.delete(clientId);
      this.objectUrls.revoke(current.previewUrl);
      this.replaceMessageUrl(thread, clientId, url);
      this.emit();
      await this.dispatchSend(conversationId, thread, clientId, payloadForAttachment(attachment, url, caption), generation);
    } catch (error) {
      if (isUploadCanceled(error)) {
        return;
      }
      const current = thread.uploads.get(clientId);
      if (!current || current.attempt !== attempt) {
        return;
      }
      const failed = nextUpload(current, {
        type: 'fail',
        attempt,
        message: `Falha ao enviar ${attachment.fileName}.`,
      });
      if (failed === 'removed' || failed === current) {
        return;
      }
      thread.uploads.set(clientId, failed);
      this.applyStatus(thread, clientId, 'error');
      this.emit();
    }
  }

  private applyUploadProgress(thread: Thread, clientId: string, attempt: number, loaded: number): void {
    const current = thread.uploads.get(clientId);
    if (!current) {
      return;
    }
    const previousPercent = percentOf(current.view);
    const next = nextUpload(current, { type: 'progress', attempt, loaded });
    if (next === 'removed' || next === current) {
      return;
    }
    thread.uploads.set(clientId, next);
    if (percentOf(next.view) !== previousPercent) {
      this.emit();
    }
  }

  private async dispatchSend(
    conversationId: ConversationId,
    thread: Thread,
    clientId: string,
    payload: OutboundPayload,
    generation?: number,
  ): Promise<void> {
    try {
      await this.transport.send({ conversationId, clientId, payload });
    } catch (error) {
      if (isSessionAborted(error)) {
        return;
      }
      if (generation !== undefined && generation !== this.generation) {
        return;
      }
      if (!this.findMessage(thread, clientId)) {
        return;
      }
      this.applyStatus(thread, clientId, 'error');
      this.error = errorMessage(error, 'Não foi possível enviar a mensagem.');
      this.errorConversationId = conversationId;
      this.emit();
    }
  }

  private bindTransport(generation: number): void {
    this.unsubscribeTransport?.();
    this.unsubscribeTransport = this.transport.subscribe((event) => {
      if (generation !== this.generation) {
        return;
      }
      this.apply(event);
    });
  }

  private async openConnection(generation: number, fresh: boolean): Promise<void> {
    try {
      const bootstrap = await this.transport.connect(this.identity);
      if (generation !== this.generation) {
        return;
      }
      this.applyBootstrap(bootstrap, generation, fresh);
      this.emit();
    } catch (error) {
      if (generation !== this.generation || isSessionAborted(error)) {
        return;
      }
      this.connection = 'error';
      this.error = errorMessage(error, 'Não foi possível conectar. Tente novamente.');
      this.emit();
    }
  }

  private applyBootstrap(bootstrap: Bootstrap, generation: number, fresh: boolean): void {
    this.tenant = bootstrap.tenant;
    this.me = bootstrap.me;
    this.directory = bootstrap.directory;
    for (const summary of bootstrap.conversations) {
      const thread = this.ensureThread(summary.conversation, summary.lastActivityAt);
      if (!thread) {
        continue;
      }
      for (const message of bootstrap.recent[summary.id] ?? []) {
        this.upsertMessage(thread, message);
      }
      thread.unread = summary.unread;
      thread.lastActivityAt = laterOf(thread.lastActivityAt, summary.lastActivityAt);
      if (summary.preview && !thread.preview) {
        thread.preview = summary.preview;
      }
    }
    if (this.activeConversationId && !this.threads.has(this.activeConversationId)) {
      this.activeConversationId = null;
    }
    const active = this.activeConversationId ? this.threads.get(this.activeConversationId) : undefined;
    if (active && this.activeConversationId && active.unread > 0) {
      this.markReadUpTo(this.activeConversationId, active);
    }
    if (!fresh) {
      this.reconcileInFlight(bootstrap, generation);
    }
  }

  /**
   * Depois de reconectar, nada fica em 'sending': o que o servidor já tem herdou o status dele (via upsert),
   * o que ele não tem é reenviado (o envio é idempotente por clientId) e, se falhar, vira 'error'.
   * Mensagens com upload em andamento seguem com o próprio fluxo.
   */
  private reconcileInFlight(bootstrap: Bootstrap, generation: number): void {
    const me = this.me;
    if (!me) {
      return;
    }
    for (const [conversationId, thread] of this.threads) {
      const known = bootstrap.recent[conversationId] ?? [];
      for (const message of [...thread.messages]) {
        if (message.authorId !== me.id || message.status !== 'sending') {
          continue;
        }
        if (this.uploadKey(thread, message.id)) {
          continue;
        }
        const clientId = message.clientId ?? message.id;
        const onServer = known.some((item) => item.id === message.id || (clientId && item.clientId === clientId));
        if (onServer) {
          continue;
        }
        void this.dispatchSend(conversationId, thread, clientId, payloadFromMessage(message), generation);
      }
    }
  }

  private origin(conversationId: ConversationId, clientId: string): MessageOrigin {
    return {
      id: clientId,
      clientId,
      tenantId: this.identity.tenantId,
      conversationId,
      authorId: this.identity.userId,
      authorName: this.me?.name ?? 'Você',
    };
  }

  /** Só aceita conversa do meu tenant da qual eu participo; o resto é ignorado. */
  private ensureThread(conversation: Conversation, lastActivityAt?: string): Thread | undefined {
    if (conversation.tenantId !== this.identity.tenantId || !participates(conversation, this.identity.userId)) {
      return undefined;
    }
    const existing = this.threads.get(conversation.id);
    if (existing) {
      existing.conversation = conversation;
      return existing;
    }
    const thread: Thread = {
      conversation,
      messages: [],
      typing: IDLE_TYPING,
      unread: 0,
      lastActivityAt: lastActivityAt ?? this.now(),
      preview: undefined,
      aliases: new IdAliasIndex(),
      pendingStatus: new PendingStatusMap(this.pendingLimit, this.pendingTtlMs, () => Date.parse(this.now())),
      uploads: new Map(),
      controllers: new Map(),
    };
    this.threads.set(conversation.id, thread);
    return thread;
  }

  /** Marca como lida a última mensagem de outro usuário. A contagem local zera de imediato. */
  private markReadUpTo(conversationId: ConversationId, thread: Thread): void {
    const myId = this.identity.userId;
    const last = [...thread.messages].reverse().find((message) => message.authorId !== myId);
    thread.unread = 0;
    if (!last) {
      return;
    }
    void this.transport.markRead({ conversationId, upToMessageId: last.id }).catch(() => {
      // Sem conexão agora: o servidor recalcula o não lido no próximo Bootstrap.
    });
  }

  private apply(event: ChatEvent): void {
    if (event.type === 'connection') {
      this.connection = event.status;
      if (event.status === 'connected') {
        this.clearError();
      }
      if (event.status === 'error' && !this.error) {
        this.error = 'Falha na conexão.';
      }
      this.emit();
      return;
    }
    // Defesa em profundidade: o transporte já filtra, mas nada de outro tenant entra na sessão.
    if (event.tenantId !== this.identity.tenantId) {
      return;
    }
    const myId = this.identity.userId;
    switch (event.type) {
      case 'message': {
        const thread = this.threads.get(event.message.conversationId);
        if (!thread || event.message.tenantId !== this.identity.tenantId) {
          return;
        }
        const added = this.upsertMessage(thread, event.message);
        if (added && event.message.authorId !== myId) {
          if (this.activeConversationId === event.message.conversationId) {
            this.markReadUpTo(event.message.conversationId, thread);
          } else {
            thread.unread += 1;
          }
        }
        break;
      }
      case 'status': {
        const thread = this.threads.get(event.conversationId);
        if (!thread) {
          return;
        }
        thread.aliases.link(event.clientId, event.messageId);
        this.applyStatus(thread, event.messageId, event.status);
        if (event.clientId) {
          this.applyStatus(thread, event.clientId, event.status);
        }
        break;
      }
      case 'typing': {
        const thread = this.threads.get(event.conversationId);
        if (!thread || event.userId === myId) {
          return;
        }
        thread.typing = event.isTyping
          ? { isTyping: true, actorName: this.directory?.users[event.userId]?.name ?? '' }
          : IDLE_TYPING;
        break;
      }
      case 'read': {
        const thread = this.threads.get(event.conversationId);
        if (!thread) {
          return;
        }
        if (event.userId === myId) {
          // Li em outra aba: o não lido daqui some.
          thread.unread = 0;
        } else {
          this.raiseOwnToRead(thread, event.upToMessageId);
        }
        break;
      }
      case 'conversation': {
        if (!this.ensureThread(event.conversation)) {
          return;
        }
        break;
      }
      case 'grants': {
        const directory = this.directory;
        const target = directory?.users[event.userId];
        if (!directory || !target) {
          return;
        }
        const updated = { ...target, grants: new Set(event.grants) };
        this.directory = { ...directory, users: { ...directory.users, [event.userId]: updated } };
        if (this.me?.id === event.userId) {
          this.me = updated;
        }
        break;
      }
      default: {
        const exhaustive: never = event;
        return exhaustive;
      }
    }
    this.emit();
  }

  /** Um colega leu até aquela mensagem: as minhas até ali passam a 'read'. */
  private raiseOwnToRead(thread: Thread, upToMessageId: string): void {
    const myId = this.identity.userId;
    const limit = thread.messages.findIndex((message) => this.matchesId(thread, message, upToMessageId));
    if (limit === -1) {
      return;
    }
    thread.messages = thread.messages.map((message, index) =>
      index <= limit && message.authorId === myId && message.status !== 'sending'
        ? { ...message, status: mergeStatus(message.status, 'read') }
        : message,
    );
  }

  /** Devolve `true` se a mensagem é nova na conversa. */
  private upsertMessage(thread: Thread, incoming: ChatMessage): boolean {
    thread.aliases.link(incoming.clientId, incoming.id);
    const keys = this.aliasKeys(thread, incoming.id, incoming.clientId);
    const pending = thread.pendingStatus.take(keys);
    const next = { ...incoming, status: pending ? mergeStatus(incoming.status, pending) : incoming.status };
    const index = thread.messages.findIndex((message) => this.sameMessage(thread, message, incoming));
    if (index === -1) {
      thread.messages = [...thread.messages, next];
      thread.lastActivityAt = laterOf(thread.lastActivityAt, incoming.timestamp);
      thread.preview = previewLine(incoming);
      return true;
    }
    const current = thread.messages[index];
    if (!current) {
      return false;
    }
    const merged: ChatMessage = {
      ...current,
      ...next,
      id: incoming.id,
      status: mergeStatus(current.status, next.status),
    };
    if (current.clientId) {
      merged.clientId = current.clientId;
    } else if (incoming.clientId) {
      merged.clientId = incoming.clientId;
    }
    thread.messages = thread.messages.map((message, position) => (position === index ? merged : message));
    return false;
  }

  private applyStatus(thread: Thread, id: string, status: MessageStatus, reset = false): void {
    const index = thread.messages.findIndex((message) => this.matchesId(thread, message, id));
    if (index === -1) {
      thread.pendingStatus.add(thread.aliases.root(id), status);
      thread.pendingStatus.add(id, status);
      return;
    }
    const current = thread.messages[index];
    if (!current) {
      return;
    }
    const nextStatus = reset ? status : mergeStatus(current.status, status);
    if (nextStatus === current.status) {
      return;
    }
    thread.messages = thread.messages.map((message, position) =>
      position === index ? { ...message, status: nextStatus } : message,
    );
  }

  private replaceMessageUrl(thread: Thread, id: string, url: string): void {
    thread.messages = thread.messages.map((message) => {
      if (!this.matchesId(thread, message, id) || !('url' in message)) {
        return message;
      }
      return { ...message, url };
    });
  }

  private findMessage(thread: Thread, id: string): ChatMessage | undefined {
    return thread.messages.find((message) => this.matchesId(thread, message, id));
  }

  private uploadKey(thread: Thread, messageId: string): string | undefined {
    if (thread.uploads.has(messageId)) {
      return messageId;
    }
    for (const key of this.aliasKeys(thread, messageId)) {
      if (thread.uploads.has(key)) {
        return key;
      }
    }
    const message = this.findMessage(thread, messageId);
    if (message?.clientId && thread.uploads.has(message.clientId)) {
      return message.clientId;
    }
    return undefined;
  }

  private clearAllUploads(): void {
    for (const thread of this.threads.values()) {
      for (const [id, entry] of thread.uploads) {
        thread.controllers.get(id)?.abort();
        this.objectUrls.revoke(entry.previewUrl);
      }
      thread.uploads.clear();
      thread.controllers.clear();
    }
  }

  private matchesId(thread: Thread, message: ChatMessage, id: string): boolean {
    const keys = this.aliasKeys(thread, id);
    return keys.has(message.id) || Boolean(message.clientId && keys.has(message.clientId));
  }

  private sameMessage(thread: Thread, existing: ChatMessage, incoming: ChatMessage): boolean {
    return (
      this.matchesId(thread, existing, incoming.id) ||
      Boolean(incoming.clientId && this.matchesId(thread, existing, incoming.clientId))
    );
  }

  private aliasKeys(thread: Thread, ...ids: Array<string | undefined>): Set<string> {
    const keys = new Set<string>();
    for (const id of ids) {
      if (!id) {
        continue;
      }
      for (const member of thread.aliases.group(id)) {
        keys.add(member);
      }
    }
    return keys;
  }

  private snapshot(): ChatSessionState {
    const conversations: Record<string, ThreadState> = {};
    const summaries: ConversationSummary[] = [];
    for (const [id, thread] of this.threads) {
      const uploads: Record<string, UploadView> = {};
      for (const [clientId, entry] of thread.uploads) {
        uploads[clientId] = entry.view;
      }
      conversations[id] = {
        conversation: thread.conversation,
        messages: thread.messages,
        typing: thread.typing,
        uploads,
        unread: thread.unread,
        lastActivityAt: thread.lastActivityAt,
        ...(thread.preview ? { preview: thread.preview } : {}),
      };
      summaries.push({
        id,
        conversation: thread.conversation,
        lastActivityAt: thread.lastActivityAt,
        ...(thread.preview ? { preview: thread.preview } : {}),
        unread: thread.unread,
      });
    }
    summaries.sort((a, b) => {
      const diff = Date.parse(b.lastActivityAt) - Date.parse(a.lastActivityAt);
      if (diff !== 0 && !Number.isNaN(diff)) {
        return diff;
      }
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });
    return {
      connection: this.connection,
      error: this.error,
      errorConversationId: this.errorConversationId,
      tenant: this.tenant,
      me: this.me,
      directory: this.directory,
      conversations: conversations,
      summaries,
      activeConversationId: this.activeConversationId,
    };
  }

  private emit(): void {
    const state = this.snapshot();
    for (const listener of this.listeners) {
      listener(state);
    }
  }
}

function participates(conversation: Conversation, userId: UserId): boolean {
  return conversation.kind === 'direct'
    ? conversation.participants.includes(userId)
    : conversation.members.includes(userId);
}

function previewLine(message: ChatMessage): string | undefined {
  return previewOf(message).split('\n')[0]?.trim() || undefined;
}

function laterOf(a: string, b: string): string {
  const left = Date.parse(a);
  const right = Date.parse(b);
  if (Number.isNaN(left)) {
    return b;
  }
  if (Number.isNaN(right)) {
    return a;
  }
  return right > left ? b : a;
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

function percentOf(view: UploadView): number {
  if (view.phase !== 'uploading' || view.total === 0) {
    return -1;
  }
  return Math.floor((view.loaded / view.total) * 100);
}
