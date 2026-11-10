import type { MessageAuthor, TextMessage } from '../domain/message';
import { isSessionAborted, SessionAbortedError } from './abort';
import type {
  ChatEvent,
  ChatEventHandler,
  ChatTransport,
  ConnectSession,
  SendRequest,
  TransportStatus,
} from './ChatTransport';
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
  failConnect?: boolean;
  failSend?: boolean;
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
  failConnect: boolean;
  failSend: boolean;
  private readonly handlers = new Set<ChatEventHandler>();
  private readonly timers = new Set<ReturnType<typeof setTimeout>>();
  private abort = new AbortController();
  private epoch = 0;
  private status: TransportStatus = 'disconnected';
  private conversationId = '';
  private patientName = 'Paciente';
  private ended = false;
  private botQueue: Promise<void> = Promise.resolve();
  private idSeq = 0;

  constructor(options: MockTransportOptions = {}) {
    this.delays = { ...DEFAULT_DELAYS, ...options.delays };
    this.now = options.now ?? (() => new Date().toISOString());
    this.failConnect = options.failConnect ?? false;
    this.failSend = options.failSend ?? false;
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
    this.resetSession();
    this.conversationId = session.conversationId;
    this.patientName = session.patientName;
    this.ended = false;
    this.setStatus('connecting');
    if (this.failConnect) {
      this.setStatus('error');
      throw new Error('Falha ao conectar');
    }
    this.setStatus('connected');
    const epoch = this.epoch;
    await this.runBotTurn(epoch, () => {
      this.emitMessage(this.botText(welcomeText(this.patientName), PRE_ATENDIMENTO_MENU));
    });
  }

  disconnect(): void {
    this.abortPending();
    this.setStatus('disconnected');
  }

  send(request: SendRequest): Promise<void> {
    if (this.status !== 'connected') {
      return Promise.reject(new Error('Não conectado'));
    }
    if (this.failSend) {
      return Promise.reject(new Error('Falha ao enviar'));
    }
    switch (request.payload.type) {
      case 'text':
        break;
      case 'image':
      case 'audio':
      case 'video':
      case 'document':
      case 'sticker':
        this.emit({
          type: 'status',
          messageId: request.clientId,
          clientId: request.clientId,
          status: 'error',
        });
        return Promise.reject(new Error('Mídia ainda não suportada nesta etapa'));
      default: {
        const exhaustive: never = request.payload;
        return exhaustive;
      }
    }
    const text = request.payload.text.trim();
    if (!text) {
      return Promise.resolve();
    }
    const epoch = this.epoch;
    const message = this.clientText(text, request.clientId);
    this.emit({ type: 'message', message });
    void this.progressClient(message, text, epoch);
    return Promise.resolve();
  }

  private async progressClient(message: TextMessage, text: string, epoch: number): Promise<void> {
    try {
      await this.wait(this.delays.sentMs);
      this.guard(epoch);
      this.emitStatus(message.id, message.clientId, 'sent');
      await this.wait(this.delays.deliveredMs);
      this.guard(epoch);
      this.emitStatus(message.id, message.clientId, 'delivered');
      await this.wait(this.delays.readMs);
      this.guard(epoch);
      this.emitStatus(message.id, message.clientId, 'read');
      if (this.ended) {
        return;
      }
      this.botQueue = this.botQueue.then(() => this.replyAsBot(text, epoch), () => this.replyAsBot(text, epoch));
      await this.botQueue;
    } catch (error) {
      if (isSessionAborted(error)) {
        return;
      }
      this.emitStatus(message.id, message.clientId, 'error');
    }
  }

  private async replyAsBot(text: string, epoch: number): Promise<void> {
    this.guard(epoch);
    if (this.ended) {
      return;
    }
    const reply = replyForChoice(text);
    this.ended = reply.ended;
    await this.runBotTurn(epoch, () => {
      this.emitMessage(this.botText(reply.text, reply.menu));
      if (reply.ended) {
        this.emit({ type: 'ended', conversationId: this.conversationId });
      }
    });
  }

  private async runBotTurn(epoch: number, emit: () => void): Promise<void> {
    this.guard(epoch);
    this.emit({
      type: 'typing',
      conversationId: this.conversationId,
      actor: BOT,
      isTyping: true,
    });
    await this.wait(this.delays.typingMs);
    this.guard(epoch);
    this.emit({
      type: 'typing',
      conversationId: this.conversationId,
      actor: BOT,
      isTyping: false,
    });
    await this.wait(this.delays.replyMs);
    this.guard(epoch);
    emit();
  }

  private clientText(text: string, clientId: string): TextMessage {
    return {
      id: clientId,
      conversationId: this.conversationId,
      clientId,
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

  private emitStatus(
    messageId: string,
    clientId: string | undefined,
    status: 'sent' | 'delivered' | 'read' | 'error',
  ): void {
    this.emit({
      type: 'status',
      messageId,
      status,
      ...(clientId ? { clientId } : {}),
    });
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

  private resetSession(): void {
    this.abortPending();
    this.epoch += 1;
    this.abort = new AbortController();
    this.botQueue = Promise.resolve();
  }

  private abortPending(): void {
    this.abort.abort();
    for (const timer of this.timers) {
      clearTimeout(timer);
    }
    this.timers.clear();
    this.botQueue = Promise.resolve();
  }

  private guard(epoch: number): void {
    if (epoch !== this.epoch || this.abort.signal.aborted) {
      throw new SessionAbortedError();
    }
  }

  private wait(ms: number): Promise<void> {
    if (this.abort.signal.aborted) {
      return Promise.reject(new SessionAbortedError());
    }
    if (ms <= 0) {
      return Promise.resolve();
    }
    return new Promise((resolve, reject) => {
      const { signal } = this.abort;
      const onAbort = () => {
        clearTimeout(timer);
        this.timers.delete(timer);
        reject(new SessionAbortedError());
      };
      const timer = setTimeout(() => {
        signal.removeEventListener('abort', onAbort);
        this.timers.delete(timer);
        resolve();
      }, ms);
      this.timers.add(timer);
      signal.addEventListener('abort', onAbort, { once: true });
    });
  }
}
