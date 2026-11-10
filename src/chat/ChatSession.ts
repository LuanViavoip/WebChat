import type { ChatMessage, MenuOption } from '../domain/message';
import { isTextMessage } from '../domain/message';
import type { ChatEvent, ChatTransport, TransportStatus } from '../transport/ChatTransport';

export type TypingState = {
  isTyping: boolean;
  actorName: string;
};

export type ChatSessionState = {
  messages: ChatMessage[];
  connection: TransportStatus;
  typing: TypingState;
  menu: MenuOption[];
};

export type ChatSessionListener = (state: ChatSessionState) => void;

const IDLE_TYPING: TypingState = { isTyping: false, actorName: '' };

export class ChatSession {
  private messages: ChatMessage[] = [];
  private connection: TransportStatus = 'disconnected';
  private typing: TypingState = IDLE_TYPING;
  private readonly listeners = new Set<ChatSessionListener>();
  private unsubscribeTransport: (() => void) | undefined;

  constructor(private readonly transport: ChatTransport) {}

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

  async start(patientName: string, conversationId = 'conv-web'): Promise<void> {
    this.messages = [];
    this.typing = IDLE_TYPING;
    this.connection = 'disconnected';
    this.unsubscribeTransport?.();
    this.unsubscribeTransport = this.transport.subscribe((event) => {
      this.apply(event);
    });
    this.emit();
    await this.transport.connect({ conversationId, patientName });
  }

  stop(): void {
    this.unsubscribeTransport?.();
    this.unsubscribeTransport = undefined;
    this.transport.disconnect();
  }

  async send(text: string): Promise<void> {
    await this.transport.send(text);
  }

  async sendMenuOption(option: MenuOption): Promise<void> {
    await this.transport.send(option.key);
  }

  private apply(event: ChatEvent): void {
    switch (event.type) {
      case 'message':
        this.messages = [...this.messages, event.message];
        break;
      case 'status':
        this.messages = this.messages.map((message) =>
          message.id === event.messageId ? { ...message, status: event.status } : message,
        );
        break;
      case 'typing':
        this.typing = event.isTyping
          ? { isTyping: true, actorName: event.actor.name }
          : IDLE_TYPING;
        break;
      case 'connection':
        this.connection = event.status;
        break;
      default: {
        const exhaustive: never = event;
        return exhaustive;
      }
    }
    this.emit();
  }

  private snapshot(): ChatSessionState {
    return {
      messages: this.messages,
      connection: this.connection,
      typing: this.typing,
      menu: lastBotMenu(this.messages),
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
    if (message && isTextMessage(message) && message.direction === 'bot' && message.menu) {
      return message.menu;
    }
  }
  return [];
}
