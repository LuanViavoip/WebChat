import { UploadCanceledError, UploadFailedError } from '../transport/abort';
import type {
  ChatEvent,
  ChatEventHandler,
  ChatTransport,
  ConnectSession,
  SendRequest,
  TransportStatus,
  UploadedMedia,
  UploadRequest,
} from '../transport/ChatTransport';

type HeldSend = {
  request: SendRequest;
  resolve: () => void;
  reject: (error: Error) => void;
};

type HeldUpload = {
  request: UploadRequest;
  resolve: (media: UploadedMedia) => void;
  reject: (error: Error) => void;
};

export class ScriptedTransport implements ChatTransport {
  readonly sent: SendRequest[] = [];
  readonly uploads: UploadRequest[] = [];
  lastSession: ConnectSession | undefined;
  failConnect = false;
  failSend = false;
  holdSend = false;
  holdConnect = false;
  holdUpload = false;
  failUpload = false;
  private readonly held: HeldSend[] = [];
  private readonly heldUploads: HeldUpload[] = [];
  private connectHeld: { resolve: () => void } | undefined;
  private status: TransportStatus = 'disconnected';
  private readonly handlers = new Set<ChatEventHandler>();

  subscribe(handler: ChatEventHandler): () => void {
    this.handlers.add(handler);
    return () => {
      this.handlers.delete(handler);
    };
  }

  getStatus(): TransportStatus {
    return this.status;
  }

  emit(event: ChatEvent): void {
    for (const handler of this.handlers) {
      handler(event);
    }
  }

  connect(session: ConnectSession): Promise<void> {
    this.lastSession = session;
    this.status = 'connecting';
    this.emit({ type: 'connection', status: 'connecting' });
    if (this.failConnect) {
      this.status = 'error';
      this.emit({ type: 'connection', status: 'error' });
      return Promise.reject(new Error('Falha ao conectar'));
    }
    if (this.holdConnect) {
      return new Promise((resolve) => {
        this.connectHeld = { resolve };
      });
    }
    this.status = 'connected';
    this.emit({ type: 'connection', status: 'connected' });
    return Promise.resolve();
  }

  releaseConnect(): void {
    this.status = 'connected';
    this.emit({ type: 'connection', status: 'connected' });
    this.connectHeld?.resolve();
    this.connectHeld = undefined;
  }

  disconnect(): void {
    this.status = 'disconnected';
    this.emit({ type: 'connection', status: 'disconnected' });
  }

  send(request: SendRequest): Promise<void> {
    this.sent.push(request);
    if (this.holdSend) {
      return new Promise((resolve, reject) => {
        this.held.push({ request, resolve, reject });
      });
    }
    if (this.failSend) {
      return Promise.reject(new Error('Falha ao enviar'));
    }
    return Promise.resolve();
  }

  upload(request: UploadRequest): Promise<UploadedMedia> {
    this.uploads.push(request);
    if (request.signal.aborted) {
      return Promise.reject(new UploadCanceledError());
    }
    if (this.holdUpload) {
      return new Promise((resolve, reject) => {
        this.heldUploads.push({ request, resolve, reject });
        request.signal.addEventListener(
          'abort',
          () => {
            reject(new UploadCanceledError());
          },
          { once: true },
        );
      });
    }
    if (this.failUpload) {
      return Promise.reject(new UploadFailedError('Falha no upload simulado'));
    }
    return Promise.resolve({ url: `uploaded:${request.fileName}` });
  }

  progressUpload(index: number, loaded: number): void {
    const request = this.uploads[index];
    request?.onProgress({ loaded, total: request.file.size });
  }

  resolveUpload(index: number, url: string): void {
    this.heldUploads[index]?.resolve({ url });
  }

  rejectUpload(index: number, error: Error = new UploadFailedError('Falha no upload simulado')): void {
    this.heldUploads[index]?.reject(error);
  }

  rejectHeld(error: Error = new Error('Falha tardia de envio')): void {
    const pending = this.held.splice(0, this.held.length);
    for (const item of pending) {
      item.reject(error);
    }
  }
}
