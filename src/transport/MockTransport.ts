import type { ChatMessage } from '../domain/message';
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
};

const DEFAULT_DELAYS: MockDelays = {
  connectMs: 0,
  sentMs: 120,
  deliveredMs: 280,
  readMs: 520,
  uploadChunkMs: 150,
};

export class MockTransport implements ChatTransport {
  private readonly delays: MockDelays;
  private readonly now: () => string;
  private readonly uploadChunks: number;
  private readonly objectUrls: ObjectUrlFactory;
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
  private conversationId = '';
  private readyGate: Promise<void> = Promise.resolve();
  private unlockReady: (() => void) | undefined;
  private readonly uploadAttempts = new Map<string, number>();
  private readonly remoteUrlsByConversation = new Map<string, string[]>();

  constructor(options: MockTransportOptions = {}) {
    this.delays = { ...DEFAULT_DELAYS, ...options.delays };
    this.now = options.now ?? (() => new Date().toISOString());
    this.failConnect = options.failConnect ?? false;
    this.failSend = options.failSend ?? false;
    this.failUpload = options.failUpload ?? 'never';
    this.holdConnect = options.holdConnect ?? false;
    this.uploadChunks = options.uploadChunks ?? 5;
    this.objectUrls = options.objectUrls ?? browserObjectUrls;
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
    this.setStatus('connected');
    this.unlockReady?.();
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
    this.setStatus('disconnected');
    this.unlockReady?.();
  }

  send(request: SendRequest): Promise<void> {
    if (this.status === 'disconnected' || this.status === 'error') {
      return Promise.reject(new Error('Não conectado'));
    }
    if (this.status === 'connected') {
      return this.dispatchSend(request);
    }
    const conversationEpoch = this.conversationEpoch;
    return this.whenReady().then(() => {
      this.guardConversation(conversationEpoch);
      return this.dispatchSend(request);
    });
  }

  upload(request: UploadRequest): Promise<UploadedMedia> {
    if (this.status === 'disconnected' || this.status === 'error') {
      return Promise.reject(new Error('Não conectado'));
    }
    if (this.status === 'connecting') {
      const conversationEpoch = this.conversationEpoch;
      return this.whenReady().then(() => {
        this.guardConversation(conversationEpoch);
        return this.runUpload(request);
      });
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
    const conversationEpoch = this.conversationEpoch;
    const message = messageFromPayload(
      request.clientId,
      this.conversationId,
      request.payload,
      this.now(),
      'sending',
    );
    this.emit({ type: 'message', message });
    void this.progressClient(message, conversationEpoch);
    return Promise.resolve();
  }

  private async progressClient(message: ChatMessage, conversationEpoch: number): Promise<void> {
    try {
      await this.wait(this.delays.sentMs, undefined, 'conversation');
      this.guardConversation(conversationEpoch);
      this.emitStatus(message.id, message.clientId, 'sent');
      await this.wait(this.delays.deliveredMs, undefined, 'conversation');
      this.guardConversation(conversationEpoch);
      this.emitStatus(message.id, message.clientId, 'delivered');
      await this.wait(this.delays.readMs, undefined, 'conversation');
      this.guardConversation(conversationEpoch);
      this.emitStatus(message.id, message.clientId, 'read');
    } catch (error) {
      if (isSessionAborted(error)) {
        return;
      }
      this.emitStatus(message.id, message.clientId, 'error');
    }
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
