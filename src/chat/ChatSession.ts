import type { ChatMessage, MenuOption, MessageStatus } from '../domain/message';
import { isTextMessage } from '../domain/message';
import { isSessionAborted } from '../transport/abort';
import type {
  ChatEvent,
  ChatTransport,
  OutboundPayload,
  TransportStatus,
} from '../transport/ChatTransport';
import { IdAliasIndex } from './idAlias';
import { messageFromPayload, normalizePayload, payloadFromMessage } from './outbound';
import { DEFAULT_PENDING_LIMIT, DEFAULT_PENDING_TTL_MS, PendingStatusMap } from './pendingStatus';
import { mergeStatus } from './statusRank';

export type TypingState = {
  isTyping: boolean;
  actorName: string;
};

export type ChatSessionState = {
  messages: ChatMessage[];
  connection: TransportStatus;
  typing: TypingState;
  menu: MenuOption[];
  ended: boolean;
  error: string | null;
};

export type ChatSessionListener = (state: ChatSessionState) => void;

export type ChatSessionOptions = {
  createId?: () => string;
  now?: () => string;
  pendingLimit?: number;
  pendingTtlMs?: number;
};

const IDLE_TYPING: TypingState = { isTyping: false, actorName: '' };

export class ChatSession {
  private messages: ChatMessage[] = [];
  private connection: TransportStatus = 'disconnected';
  private typing: TypingState = IDLE_TYPING;
  private ended = false;
  private error: string | null = null;
  private generation = 0;
  private conversationId = 'conv-web';
  private patientName = '';
  private readonly aliases = new IdAliasIndex();
  private readonly pendingStatus: PendingStatusMap;
  private readonly listeners = new Set<ChatSessionListener>();
  private unsubscribeTransport: (() => void) | undefined;
  private readonly createId: () => string;
  private readonly now: () => string;

  constructor(
    private readonly transport: ChatTransport,
    options: ChatSessionOptions = {},
  ) {
    this.createId = options.createId ?? (() => crypto.randomUUID());
    this.now = options.now ?? (() => new Date().toISOString());
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

  async start(patientName: string, conversationId = nextConversationId()): Promise<void> {
    this.generation += 1;
    const generation = this.generation;
    this.messages = [];
    this.typing = IDLE_TYPING;
    this.ended = false;
    this.error = null;
    this.pendingStatus.clear();
    this.aliases.clear();
    this.conversationId = conversationId;
    this.patientName = patientName;
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
    this.unsubscribeTransport?.();
    this.unsubscribeTransport = undefined;
    this.transport.disconnect();
  }

  async send(payload: OutboundPayload): Promise<void> {
    if (this.ended) {
      return;
    }
    const normalized = normalizePayload(payload);
    if (!normalized) {
      return;
    }
    const generation = this.generation;
    const clientId = this.createId();
    this.aliases.link(clientId, clientId);
    this.upsertMessage(messageFromPayload(clientId, this.conversationId, normalized, this.now(), 'sending'));
    this.emit();
    try {
      await this.transport.send({ clientId, payload: normalized });
    } catch (error) {
      if (generation !== this.generation || isSessionAborted(error)) {
        return;
      }
      this.applyStatus(clientId, 'error');
      this.error = errorMessage(error, 'Não foi possível enviar a mensagem.');
      this.emit();
    }
  }

  async sendMenuOption(option: MenuOption): Promise<void> {
    await this.send({ type: 'text', text: option.key });
  }

  async retry(messageId: string): Promise<void> {
    const message = this.findMessage(messageId);
    if (!message || message.status !== 'error') {
      return;
    }
    const generation = this.generation;
    this.error = null;
    this.applyStatus(message.id, 'sending', true);
    const clientId = message.clientId ?? message.id;
    try {
      await this.transport.send({ clientId, payload: payloadFromMessage(message) });
    } catch (error) {
      if (generation !== this.generation || isSessionAborted(error)) {
        return;
      }
      this.applyStatus(message.id, 'error', true);
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
      await this.transport.connect({ conversationId: this.conversationId, patientName: this.patientName });
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
      case 'ended':
        this.ended = true;
        this.typing = IDLE_TYPING;
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

  private findMessage(id: string): ChatMessage | undefined {
    return this.messages.find((message) => this.matchesId(message, id));
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
    return {
      messages: this.messages,
      connection: this.connection,
      typing: this.typing,
      menu: this.ended ? [] : lastBotMenu(this.messages),
      ended: this.ended,
      error: this.error,
    };
  }

  private emit(): void {
    const state = this.snapshot();
    for (const listener of this.listeners) {
      listener(state);
    }
  }
}

function lastBotMenu(messages: ChatMessage[]): MenuOption[] {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message && isTextMessage(message) && message.direction === 'bot') {
      return message.menu ?? [];
    }
  }
  return [];
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

function nextConversationId(): string {
  return `conv-web-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
