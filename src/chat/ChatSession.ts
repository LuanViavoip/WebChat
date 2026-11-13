import { type ValidAttachment } from '../domain/attachment';
import { asConversationId } from '../domain/conversation';
import type { ChatMessage, MessageStatus } from '../domain/message';
import { isSessionAborted, isUploadCanceled } from '../transport/abort';
import type {
  ChatEvent,
  ChatTransport,
  OutboundPayload,
  TransportStatus,
} from '../transport/ChatTransport';
import { browserObjectUrls, type ObjectUrlFactory } from '../transport/objectUrls';
import { IdAliasIndex } from './idAlias';
import { messageFromPayload, normalizePayload, payloadForAttachment, payloadFromMessage } from './outbound';
import { DEFAULT_PENDING_LIMIT, DEFAULT_PENDING_TTL_MS, PendingStatusMap } from './pendingStatus';
import { mergeStatus } from './statusRank';
import { beginUpload, nextUpload, type UploadEntry, type UploadView } from './uploads';

export type TypingState = {
  isTyping: boolean;
  actorName: string;
};

export type ChatSessionState = {
  messages: ChatMessage[];
  connection: TransportStatus;
  typing: TypingState;
  error: string | null;
  uploads: Readonly<Record<string, UploadView>>;
};

export type ChatSessionListener = (state: ChatSessionState) => void;

export type ChatSessionOptions = {
  createId?: () => string;
  now?: () => string;
  pendingLimit?: number;
  pendingTtlMs?: number;
  objectUrls?: ObjectUrlFactory;
};

const IDLE_TYPING: TypingState = { isTyping: false, actorName: '' };

export class ChatSession {
  private messages: ChatMessage[] = [];
  private connection: TransportStatus = 'disconnected';
  private typing: TypingState = IDLE_TYPING;
  private error: string | null = null;
  private generation = 0;
  private conversationId = 'conv-web';
  private readonly aliases = new IdAliasIndex();
  private readonly pendingStatus: PendingStatusMap;
  private readonly listeners = new Set<ChatSessionListener>();
  private unsubscribeTransport: (() => void) | undefined;
  private readonly createId: () => string;
  private readonly now: () => string;
  private readonly objectUrls: ObjectUrlFactory;
  private readonly uploads = new Map<string, UploadEntry>();
  private readonly uploadControllers = new Map<string, AbortController>();

  constructor(
    private readonly transport: ChatTransport,
    options: ChatSessionOptions = {},
  ) {
    this.createId = options.createId ?? (() => crypto.randomUUID());
    this.now = options.now ?? (() => new Date().toISOString());
    this.objectUrls = options.objectUrls ?? browserObjectUrls;
    this.pendingStatus = new PendingStatusMap(
      options.pendingLimit ?? DEFAULT_PENDING_LIMIT,
      options.pendingTtlMs ?? DEFAULT_PENDING_TTL_MS,
      () => Date.parse(this.now()),
    );
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

  async start(conversationId = nextConversationId()): Promise<void> {
    this.generation += 1;
    const generation = this.generation;
    this.clearUploads();
    this.messages = [];
    this.typing = IDLE_TYPING;
    this.error = null;
    this.pendingStatus.clear();
    this.aliases.clear();
    this.conversationId = conversationId;
    this.connection = 'disconnected';
    this.bindTransport(generation);
    this.emit();
    await this.openConnection(generation);
  }

  async reconnect(): Promise<void> {
    this.generation += 1;
    const generation = this.generation;
    this.typing = IDLE_TYPING;
    this.error = null;
    this.bindTransport(generation);
    if (this.transport.getStatus() === 'connected') {
      this.connection = 'connected';
      this.emit();
      return;
    }
    this.connection = 'disconnected';
    this.emit();
    await this.openConnection(generation);
  }

  stop(): void {
    this.generation += 1;
    this.clearUploads();
    this.unsubscribeTransport?.();
    this.unsubscribeTransport = undefined;
    this.transport.disconnect();
  }

  async send(payload: OutboundPayload): Promise<void> {
    const normalized = normalizePayload(payload);
    if (!normalized) {
      return;
    }
    const generation = this.generation;
    const clientId = this.createId();
    this.aliases.link(clientId, clientId);
    this.upsertMessage(messageFromPayload(clientId, asConversationId(this.conversationId), normalized, this.now(), 'sending'));
    this.emit();
    await this.dispatchSend(clientId, normalized, generation);
  }

  async sendAttachment(attachment: ValidAttachment, caption?: string): Promise<void> {
    const clientId = this.createId();
    const previewUrl = this.objectUrls.create(attachment.file);
    const payload = payloadForAttachment(attachment, previewUrl, caption);
    this.aliases.link(clientId, clientId);
    this.upsertMessage(messageFromPayload(clientId, asConversationId(this.conversationId), payload, this.now(), 'sending'));
    this.uploads.set(clientId, beginUpload(attachment, caption, previewUrl));
    this.emit();
    await this.runUpload(clientId);
  }

  cancelUpload(messageId: string): void {
    const key = this.uploadKey(messageId);
    if (!key) {
      return;
    }
    const entry = this.uploads.get(key);
    if (!entry) {
      return;
    }
    const next = nextUpload(entry, { type: 'cancel' });
    if (next !== 'removed' && next === entry) {
      return;
    }
    this.uploadControllers.get(key)?.abort();
    this.uploadControllers.delete(key);
    this.uploads.delete(key);
    this.objectUrls.revoke(entry.previewUrl);
    this.messages = this.messages.filter((message) => !this.matchesId(message, key));
    this.emit();
  }

  async retry(messageId: string): Promise<void> {
    const uploadKey = this.uploadKey(messageId);
    const upload = uploadKey ? this.uploads.get(uploadKey) : undefined;
    if (upload?.view.phase === 'failed' && uploadKey) {
      const next = nextUpload(upload, { type: 'retry' });
      if (next === 'removed') {
        return;
      }
      this.uploads.set(uploadKey, next);
      this.applyStatus(uploadKey, 'sending', true);
      this.emit();
      await this.runUpload(uploadKey);
      return;
    }
    const message = this.findMessage(messageId);
    if (!message || message.status !== 'error') {
      return;
    }
    const generation = this.generation;
    this.error = null;
    this.applyStatus(message.id, 'sending', true);
    this.emit();
    const clientId = message.clientId ?? message.id;
    await this.dispatchSend(clientId, payloadFromMessage(message), generation);
  }

  private async runUpload(clientId: string): Promise<void> {
    const entry = this.uploads.get(clientId);
    if (!entry) {
      return;
    }
    const attempt = entry.attempt;
    const controller = new AbortController();
    this.uploadControllers.set(clientId, controller);
    const { attachment, caption } = entry;
    try {
      const { url } = await this.transport.upload({
        clientId,
        file: attachment.file,
        fileName: attachment.fileName,
        mimeType: attachment.mimeType,
        signal: controller.signal,
        onProgress: ({ loaded }) => {
          this.applyUploadProgress(clientId, attempt, loaded);
        },
      });
      const current = this.uploads.get(clientId);
      if (!current || current.attempt !== attempt) {
        return;
      }
      const succeeded = nextUpload(current, { type: 'succeed', attempt });
      if (succeeded !== 'removed') {
        return;
      }
      this.uploads.delete(clientId);
      this.uploadControllers.delete(clientId);
      this.objectUrls.revoke(current.previewUrl);
      this.replaceMessageUrl(clientId, url);
      this.emit();
      await this.dispatchSend(clientId, payloadForAttachment(attachment, url, caption));
    } catch (error) {
      if (isUploadCanceled(error)) {
        return;
      }
      const current = this.uploads.get(clientId);
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
      this.uploads.set(clientId, failed);
      this.applyStatus(clientId, 'error');
      this.emit();
    }
  }

  private applyUploadProgress(clientId: string, attempt: number, loaded: number): void {
    const current = this.uploads.get(clientId);
    if (!current) {
      return;
    }
    const previousPercent = percentOf(current.view);
    const next = nextUpload(current, { type: 'progress', attempt, loaded });
    if (next === 'removed' || next === current) {
      return;
    }
    this.uploads.set(clientId, next);
    if (percentOf(next.view) !== previousPercent) {
      this.emit();
    }
  }

  private async dispatchSend(
    clientId: string,
    payload: OutboundPayload,
    generation?: number,
  ): Promise<void> {
    try {
      await this.transport.send({ clientId, payload });
    } catch (error) {
      if (isSessionAborted(error)) {
        return;
      }
      if (generation !== undefined && generation !== this.generation) {
        return;
      }
      if (!this.findMessage(clientId)) {
        return;
      }
      this.applyStatus(clientId, 'error');
      this.error = errorMessage(error, 'Não foi possível enviar a mensagem.');
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

  private async openConnection(generation: number): Promise<void> {
    try {
      await this.transport.connect({ conversationId: this.conversationId });
    } catch (error) {
      if (generation !== this.generation || isSessionAborted(error)) {
        return;
      }
      this.connection = 'error';
      this.error = errorMessage(error, 'Não foi possível conectar. Tente novamente.');
      this.emit();
    }
  }

  private apply(event: ChatEvent): void {
    switch (event.type) {
      case 'message':
        this.upsertMessage(event.message);
        break;
      case 'status':
        this.aliases.link(event.clientId, event.messageId);
        this.applyStatus(event.messageId, event.status);
        if (event.clientId) {
          this.applyStatus(event.clientId, event.status);
        }
        break;
      case 'typing':
        this.typing = event.isTyping
          ? { isTyping: true, actorName: event.actor.name }
          : IDLE_TYPING;
        break;
      case 'connection':
        this.connection = event.status;
        if (event.status === 'connected') {
          this.error = null;
        }
        if (event.status === 'error' && !this.error) {
          this.error = 'Falha na conexão.';
        }
        break;
      default: {
        const exhaustive: never = event;
        return exhaustive;
      }
    }
    this.emit();
  }

  private upsertMessage(incoming: ChatMessage): void {
    this.aliases.link(incoming.clientId, incoming.id);
    const keys = this.aliasKeys(incoming.id, incoming.clientId);
    const pending = this.pendingStatus.take(keys);
    const next = { ...incoming, status: pending ? mergeStatus(incoming.status, pending) : incoming.status };
    const index = this.messages.findIndex((message) => this.sameMessage(message, incoming));
    if (index === -1) {
      this.messages = [...this.messages, next];
      return;
    }
    const current = this.messages[index];
    if (!current) {
      return;
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
    this.messages = this.messages.map((message, position) => (position === index ? merged : message));
  }

  private applyStatus(id: string, status: MessageStatus, reset = false): void {
    const index = this.messages.findIndex((message) => this.matchesId(message, id));
    if (index === -1) {
      this.pendingStatus.add(this.aliases.root(id), status);
      this.pendingStatus.add(id, status);
      return;
    }
    const current = this.messages[index];
    if (!current) {
      return;
    }
    const nextStatus = reset ? status : mergeStatus(current.status, status);
    if (nextStatus === current.status) {
      return;
    }
    this.messages = this.messages.map((message, position) =>
      position === index ? { ...message, status: nextStatus } : message,
    );
  }

  private replaceMessageUrl(id: string, url: string): void {
    this.messages = this.messages.map((message) => {
      if (!this.matchesId(message, id) || !('url' in message)) {
        return message;
      }
      return { ...message, url };
    });
  }

  private findMessage(id: string): ChatMessage | undefined {
    return this.messages.find((message) => this.matchesId(message, id));
  }

  private uploadKey(messageId: string): string | undefined {
    if (this.uploads.has(messageId)) {
      return messageId;
    }
    for (const key of this.aliasKeys(messageId)) {
      if (this.uploads.has(key)) {
        return key;
      }
    }
    const message = this.findMessage(messageId);
    if (message?.clientId && this.uploads.has(message.clientId)) {
      return message.clientId;
    }
    return undefined;
  }

  private clearUploads(): void {
    for (const [id, entry] of this.uploads) {
      this.uploadControllers.get(id)?.abort();
      this.objectUrls.revoke(entry.previewUrl);
    }
    this.uploads.clear();
    this.uploadControllers.clear();
  }

  private matchesId(message: ChatMessage, id: string): boolean {
    const keys = this.aliasKeys(id);
    return keys.has(message.id) || Boolean(message.clientId && keys.has(message.clientId));
  }

  private sameMessage(existing: ChatMessage, incoming: ChatMessage): boolean {
    return this.matchesId(existing, incoming.id) || Boolean(incoming.clientId && this.matchesId(existing, incoming.clientId));
  }

  private aliasKeys(...ids: Array<string | undefined>): Set<string> {
    const keys = new Set<string>();
    for (const id of ids) {
      if (!id) {
        continue;
      }
      for (const member of this.aliases.group(id)) {
        keys.add(member);
      }
    }
    return keys;
  }

  private snapshot(): ChatSessionState {
    const uploads: Record<string, UploadView> = {};
    for (const [id, entry] of this.uploads) {
      uploads[id] = entry.view;
    }
    return {
      messages: this.messages,
      connection: this.connection,
      typing: this.typing,
      error: this.error,
      uploads,
    };
  }

  private emit(): void {
    const state = this.snapshot();
    for (const listener of this.listeners) {
      listener(state);
    }
  }
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

function nextConversationId(): string {
  return `conv-web-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function percentOf(view: UploadView): number {
  if (view.phase !== 'uploading' || view.total === 0) {
    return -1;
  }
  return Math.floor((view.loaded / view.total) * 100);
}
