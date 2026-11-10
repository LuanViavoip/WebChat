import type { MessageAuthor, TextMessage } from '../domain/message';
import type { ChatEvent, ChatEventHandler, ChatTransport, ConnectSession, TransportStatus } from './ChatTransport';
import { PRE_ATENDIMENTO_MENU, replyForChoice, welcomeText } from './preAtendimento';

export type MockDelays = {
  typingMs: number;
  sentMs: number;
  deliveredMs: number;
  readMs: number;
  replyMs: number;
};

export type MockTransportOptions = {
  delays?: Partial<MockDelays>;
  now?: () => string;
  createId?: () => string;
};

const DEFAULT_DELAYS: MockDelays = {
  typingMs: 450,
  sentMs: 120,
  deliveredMs: 280,
  readMs: 520,
  replyMs: 700,
};

const BOT: MessageAuthor = { id: 'bot-preatendimento', name: 'ICS Pré-atendimento' };
const CLIENT: MessageAuthor = { id: 'client', name: 'Você' };

export class MockTransport implements ChatTransport {
  private readonly delays: MockDelays;
  private readonly now: () => string;
  private readonly createId: () => string;
  private readonly handlers = new Set<ChatEventHandler>();
  private readonly timers = new Set<ReturnType<typeof setTimeout>>();
  private status: TransportStatus = 'disconnected';
  private conversationId = '';
  private patientName = 'Paciente';
  private ended = false;
  private sendQueue: Promise<void> = Promise.resolve();
  private idSeq = 0;

  constructor(options: MockTransportOptions = {}) {
    this.delays = { ...DEFAULT_DELAYS, ...options.delays };
    this.now = options.now ?? (() => new Date().toISOString());
    this.createId =
      options.createId ??
      (() => {
        this.idSeq += 1;
        return `msg-${String(this.idSeq)}`;
      });
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

  async connect(session: ConnectSession): Promise<void> {
    this.conversationId = session.conversationId;
    this.patientName = session.patientName;
    this.ended = false;
    this.setStatus('connecting');
    this.setStatus('connected');
    await this.runBotTurn(() => {
      this.emitMessage(this.botText(welcomeText(this.patientName), PRE_ATENDIMENTO_MENU));
    });
  }

  disconnect(): void {
    for (const timer of this.timers) {
      clearTimeout(timer);
    }
    this.timers.clear();
    this.setStatus('disconnected');
  }

  async send(text: string): Promise<void> {
    const trimmed = text.trim();
    if (!trimmed || this.status !== 'connected') {
      return;
    }
    this.sendQueue = this.sendQueue.then(() => this.deliverClientMessage(trimmed));
    await this.sendQueue;
  }

  private async deliverClientMessage(text: string): Promise<void> {
    const message = this.clientText(text);
    this.emit({ type: 'message', message });
    await this.wait(this.delays.sentMs);
    this.emit({ type: 'status', messageId: message.id, status: 'sent' });
    await this.wait(this.delays.deliveredMs);
    this.emit({ type: 'status', messageId: message.id, status: 'delivered' });
    await this.wait(this.delays.readMs);
    this.emit({ type: 'status', messageId: message.id, status: 'read' });

    if (this.ended) {
      return;
    }

    const reply = replyForChoice(text);
    this.ended = reply.ended;
    await this.runBotTurn(() => {
      this.emitMessage(this.botText(reply.text, reply.menu));
    });
  }

  private async runBotTurn(emit: () => void): Promise<void> {
    this.emit({
      type: 'typing',
      conversationId: this.conversationId,
      actor: BOT,
      isTyping: true,
    });
    await this.wait(this.delays.typingMs);
    this.emit({
      type: 'typing',
      conversationId: this.conversationId,
      actor: BOT,
      isTyping: false,
    });
    await this.wait(this.delays.replyMs);
    emit();
  }

  private clientText(text: string): TextMessage {
    return {
      id: this.createId(),
      conversationId: this.conversationId,
      direction: 'client',
      author: CLIENT,
      timestamp: this.now(),
      status: 'sending',
      type: 'text',
      text,
    };
  }

  private botText(text: string, menu?: TextMessage['menu']): TextMessage {
    const message: TextMessage = {
      id: this.createId(),
      conversationId: this.conversationId,
      direction: 'bot',
      author: BOT,
      timestamp: this.now(),
      status: 'delivered',
      type: 'text',
      text,
    };
    if (menu) {
      message.menu = menu;
    }
    return message;
  }

  private emitMessage(message: TextMessage): void {
    this.emit({ type: 'message', message });
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

  private wait(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.timers.delete(timer);
        resolve();
      }, ms);
      this.timers.add(timer);
    });
  }
}
