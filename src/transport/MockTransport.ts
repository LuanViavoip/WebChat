import type { ChatMessage, MessageAuthor, TextMessage } from '../domain/message';
import { messageFromPayload } from '../chat/outbound';
import { isSessionAborted, SessionAbortedError, UploadCanceledError, UploadFailedError } from './abort';
import type {
  ChatEvent,
  ChatEventHandler,
  ChatTransport,
  ConnectSession,
  SendRequest,
  TransportStatus,
  UploadedMedia,
  UploadRequest,
} from './ChatTransport';
import { browserObjectUrls, type ObjectUrlFactory } from './objectUrls';
import { PRE_ATENDIMENTO_MENU, replyForChoice, welcomeText } from './preAtendimento';

export type MockDelays = {
  typingMs: number;
  sentMs: number;
  deliveredMs: number;
  readMs: number;
  replyMs: number;
  uploadChunkMs: number;
};

export type MockUploadFailure = 'never' | 'once' | 'always';

export type MockTransportOptions = {
  delays?: Partial<MockDelays>;
  now?: () => string;
  createId?: () => string;
  failConnect?: boolean;
  failSend?: boolean;
  failUpload?: MockUploadFailure;
  uploadChunks?: number;
  objectUrls?: ObjectUrlFactory;
};

const DEFAULT_DELAYS: MockDelays = {
  typingMs: 450,
  sentMs: 120,
  deliveredMs: 280,
  readMs: 520,
  replyMs: 700,
  uploadChunkMs: 150,
};

const BOT: MessageAuthor = { id: 'bot-preatendimento', name: 'ICS Pré-atendimento' };

export class MockTransport implements ChatTransport {
  private readonly delays: MockDelays;
  private readonly now: () => string;
  private readonly createId: () => string;
  private readonly uploadChunks: number;
  private readonly objectUrls: ObjectUrlFactory;
  failConnect: boolean;
  failSend: boolean;
  failUpload: MockUploadFailure;
  private readonly handlers = new Set<ChatEventHandler>();
  private readonly connectionTimers = new Set<ReturnType<typeof setTimeout>>();
  private readonly uploadTimers = new Set<ReturnType<typeof setTimeout>>();
  private abort = new AbortController();
  private lifetime = new AbortController();
  private epoch = 0;
  private conversationEpoch = 0;
  private status: TransportStatus = 'disconnected';
  private conversationId = '';
  private patientName = 'Paciente';
  private ended = false;
  private botQueue: Promise<void> = Promise.resolve();
  private welcomeGate: Promise<void> = Promise.resolve();
  private unlockWelcome: (() => void) | undefined;
  private idSeq = 0;
  private readonly uploadAttempts = new Map<string, number>();
  private readonly remoteUrlsByConversation = new Map<string, string[]>();

  constructor(options: MockTransportOptions = {}) {
    this.delays = { ...DEFAULT_DELAYS, ...options.delays };
    this.now = options.now ?? (() => new Date().toISOString());
    this.failConnect = options.failConnect ?? false;
    this.failSend = options.failSend ?? false;
    this.failUpload = options.failUpload ?? 'never';
    this.uploadChunks = options.uploadChunks ?? 5;
    this.objectUrls = options.objectUrls ?? browserObjectUrls;
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
    const previousConversationId = this.conversationId;
    const sameConversation = previousConversationId !== '' && previousConversationId === session.conversationId;
    const releasePreviousGate = this.beginConnection();
    if (!sameConversation) {
      this.resetUploadLifetime();
      if (previousConversationId) {
        this.revokeConversationUrls(previousConversationId);
      }
    }
    this.conversationId = session.conversationId;
    this.patientName = session.patientName;
    this.ended = false;
    this.setStatus('connecting');
    releasePreviousGate();
    if (this.failConnect) {
      this.setStatus('error');
      this.unlockWelcome?.();
      throw new Error('Falha ao conectar');
    }
    const epoch = this.epoch;
    this.botQueue = this.botQueue.then(() =>
      this.runBotTurn(epoch, () => {
        this.emitMessage(this.botText(welcomeText(this.patientName), PRE_ATENDIMENTO_MENU));
      }),
    );
    await this.botQueue;
    this.guard(epoch);
    this.setStatus('connected');
    this.unlockWelcome?.();
  }

  disconnect(): void {
    this.abortPending(true);
    this.revokeRemoteUrls();
    this.setStatus('disconnected');
    this.unlockWelcome?.();
  }

  send(request: SendRequest): Promise<void> {
    if (this.status === 'disconnected' || this.status === 'error') {
      return Promise.reject(new Error('Não conectado'));
    }
    if (this.status === 'connected') {
      return this.dispatchSend(request);
    }
    return this.whenReady().then(() => this.dispatchSend(request));
  }

  upload(request: UploadRequest): Promise<UploadedMedia> {
    if (this.status === 'disconnected' || this.status === 'error') {
      return Promise.reject(new Error('Não conectado'));
    }
    if (this.status === 'connecting') {
      return this.whenReady().then(() => this.runUpload(request));
    }
    return this.runUpload(request);
  }

  private async runUpload(request: UploadRequest): Promise<UploadedMedia> {
    if (this.status !== 'connected') {
      throw new Error('Não conectado');
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
      await this.wait(this.delays.uploadChunkMs, request.signal, 'upload');
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
    const urls = this.remoteUrlsByConversation.get(this.conversationId) ?? [];
    urls.push(url);
    this.remoteUrlsByConversation.set(this.conversationId, urls);
    return { url };
  }

  private dispatchSend(request: SendRequest): Promise<void> {
    if (this.status !== 'connected') {
      return Promise.reject(new Error('Não conectado'));
    }
    if (this.failSend) {
      return Promise.reject(new Error('Falha ao enviar'));
    }
    if (request.payload.type === 'text' && !request.payload.text.trim()) {
      return Promise.resolve();
    }
    const epoch = this.epoch;
    const message = messageFromPayload(
      request.clientId,
      this.conversationId,
      request.payload,
      this.now(),
      'sending',
    );
    this.emit({ type: 'message', message });
    void this.progressClient(message, epoch);
    return Promise.resolve();
  }

  private async progressClient(message: ChatMessage, epoch: number): Promise<void> {
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
      if (this.ended || message.type !== 'text') {
        return;
      }
      const text = message.text;
      this.botQueue = this.botQueue.then(
        () => this.replyAsBot(text, epoch),
        () => this.replyAsBot(text, epoch),
      );
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

  private beginConnection(): () => void {
    const releasePreviousGate = this.unlockWelcome ?? (() => {});
    this.abortPending(false);
    this.epoch += 1;
    this.abort = new AbortController();
    if (this.lifetime.signal.aborted) {
      this.lifetime = new AbortController();
    }
    this.botQueue = Promise.resolve();
    this.welcomeGate = new Promise((resolve) => {
      this.unlockWelcome = resolve;
    });
    return releasePreviousGate;
  }

  private resetUploadLifetime(): void {
    this.lifetime.abort();
    this.uploadAttempts.clear();
    this.conversationEpoch += 1;
    this.lifetime = new AbortController();
    for (const timer of this.uploadTimers) {
      clearTimeout(timer);
    }
    this.uploadTimers.clear();
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
      for (const timer of this.uploadTimers) {
        clearTimeout(timer);
      }
      this.uploadTimers.clear();
    }
    this.botQueue = Promise.resolve();
  }

  private revokeRemoteUrls(): void {
    for (const conversationId of [...this.remoteUrlsByConversation.keys()]) {
      this.revokeConversationUrls(conversationId);
    }
  }

  private revokeConversationUrls(conversationId: string): void {
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
      return this.welcomeGate.then(() => this.whenReady());
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

  private wait(
    ms: number,
    extra?: AbortSignal,
    scope: 'connection' | 'upload' = 'connection',
  ): Promise<void> {
    const sessionSignal = scope === 'upload' ? this.lifetime.signal : this.abort.signal;
    const timers = scope === 'upload' ? this.uploadTimers : this.connectionTimers;
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
