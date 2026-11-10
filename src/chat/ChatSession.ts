import type { ChatMessage, MenuOption, MessageStatus, TextMessage } from '../domain/message';
import { isTextMessage } from '../domain/message';
import { isSessionAborted } from '../transport/abort';
import type { ChatEvent, ChatTransport, SendRequest, TransportStatus } from '../transport/ChatTransport';
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
};

const IDLE_TYPING: TypingState = { isTyping: false, actorName: '' };
const CLIENT_AUTHOR = { id: 'client', name: 'Você' };

export class ChatSession {
  private messages: ChatMessage[] = [];
  private connection: TransportStatus = 'disconnected';
  private typing: TypingState = IDLE_TYPING;
  private ended = false;
  private error: string | null = null;
  private generation = 0;
  private conversationId = 'conv-web';
  private readonly pendingStatus = new Map<string, MessageStatus>();
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
    this.conversationId = conversationId;
    this.connection = 'disconnected';
    this.unsubscribeTransport?.();
    this.unsubscribeTransport = this.transport.subscribe((event) => {
      if (generation !== this.generation) {
        return;
      }
      this.apply(event);
    });
    this.emit();
    try {
      await this.transport.connect({ conversationId, patientName });
    } catch (error) {
      if (generation !== this.generation || isSessionAborted(error)) {
        return;
      }
      this.connection = 'error';
      this.error = errorMessage(error, 'Não foi possível conectar. Tente novamente.');
      this.emit();
    }
  }

  stop(): void {
    this.generation += 1;
    this.unsubscribeTransport?.();
    this.unsubscribeTransport = undefined;
    this.transport.disconnect();
  }

  async send(text: string): Promise<void> {
    const trimmed = text.trim();
    if (!trimmed || this.ended) {
      return;
    }
    const clientId = this.createId();
    const optimistic = this.optimisticText(clientId, trimmed);
    this.upsertMessage(optimistic);
    this.emit();
    const request: SendRequest = { clientId, payload: { type: 'text', text: trimmed } };
    try {
      await this.transport.send(request);
    } catch (error) {
      if (isSessionAborted(error)) {
        return;
      }
      this.applyStatus(clientId, 'error');
      this.error = errorMessage(error, 'Não foi possível enviar a mensagem.');
      this.emit();
    }
  }

  async sendMenuOption(option: MenuOption): Promise<void> {
    await this.send(option.key);
  }

  async retry(messageId: string): Promise<void> {
    const message = this.messages.find((item) => item.id === messageId);
    if (!message || !isTextMessage(message) || message.status !== 'error') {
      return;
    }
    this.error = null;
    this.applyStatus(message.id, 'sending', true);
    const clientId = message.clientId ?? message.id;
    try {
      await this.transport.send({ clientId, payload: { type: 'text', text: message.text } });
    } catch (error) {
      if (isSessionAborted(error)) {
        return;
      }
      this.applyStatus(message.id, 'error', true);
      this.error = errorMessage(error, 'Não foi possível enviar a mensagem.');
      this.emit();
    }
  }

  private optimisticText(clientId: string, text: string): TextMessage {
    return {
      id: clientId,
      conversationId: this.conversationId,
      clientId,
      direction: 'client',
      author: CLIENT_AUTHOR,
      timestamp: this.now(),
      status: 'sending',
      type: 'text',
      text,
    };
  }

  private apply(event: ChatEvent): void {
    switch (event.type) {
      case 'message':
        this.upsertMessage(event.message);
        break;
      case 'status':
        this.applyStatus(event.clientId ?? event.messageId, event.status);
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
    const key = incoming.clientId ?? incoming.id;
    const pending = this.pendingStatus.get(incoming.id) ?? this.pendingStatus.get(key);
    this.pendingStatus.delete(incoming.id);
    this.pendingStatus.delete(key);
    const status = pending ? mergeStatus(incoming.status, pending) : incoming.status;
    const next = { ...incoming, status };
    const index = this.messages.findIndex((message) => matches(message, incoming));
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
      status: mergeStatus(current.status, next.status),
    };
    this.messages = this.messages.map((message, position) => (position === index ? merged : message));
  }

  private applyStatus(id: string, status: MessageStatus, reset = false): void {
    const index = this.messages.findIndex((message) => message.id === id || message.clientId === id);
    if (index === -1) {
      const pending = this.pendingStatus.get(id);
      this.pendingStatus.set(id, reset || !pending ? status : mergeStatus(pending, status));
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

function matches(existing: ChatMessage, incoming: ChatMessage): boolean {
  if (existing.id === incoming.id) {
    return true;
  }
  return Boolean(existing.clientId && incoming.clientId && existing.clientId === incoming.clientId);
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
