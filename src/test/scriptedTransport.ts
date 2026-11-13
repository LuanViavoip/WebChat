import { UploadCanceledError, UploadFailedError } from '../transport/abort';
import type { ConversationId, DirectConversation } from '../domain/conversation';
import type { ChatMessage, MessageStatus } from '../domain/message';
import type { UserId } from '../domain/identity';
import type {
  Bootstrap,
  ChatEvent,
  ChatEventHandler,
  ChatTransport,
  ConnectRequest,
  MarkReadRequest,
  OpenDirectRequest,
  SendRequest,
  TransportStatus,
  TypingRequest,
  UploadedMedia,
  UploadRequest,
} from '../transport/ChatTransport';
import { DEFAULT_SESSION, ICS_TENANT, LIVE_CONVERSATION_ID, icsDirectory } from '../transport/mock/seed';

/** Eventos de teste sem o escopo: tenant e conversa padrão são preenchidos. */
export type ScriptedEvent =
  | { type: 'connection'; status: TransportStatus }
  | { type: 'message'; message: ChatMessage }
  | { type: 'status'; messageId: string; clientId?: string; status: MessageStatus; conversationId?: ConversationId }
  | { type: 'typing'; userId: UserId; isTyping: boolean; conversationId?: ConversationId };

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
  lastSession: ConnectRequest | undefined;
  readonly marked: MarkReadRequest[] = [];
  readonly typing: TypingRequest[] = [];
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

  emit(event: ScriptedEvent | ChatEvent): void {
    const scoped = this.scope(event);
    for (const handler of this.handlers) {
      handler(scoped);
    }
  }

  private scope(event: ScriptedEvent | ChatEvent): ChatEvent {
    if (event.type === 'connection' || 'tenantId' in event) {
      return event;
    }
    const tenantId = DEFAULT_SESSION.tenantId;
    if (event.type === 'message') {
      return { ...event, tenantId };
    }
    return { ...event, tenantId, conversationId: event.conversationId ?? LIVE_CONVERSATION_ID };
  }

  private bootstrap(): Bootstrap {
    const directory = icsDirectory();
    const me = directory.users[DEFAULT_SESSION.userId];
    if (!me) {
      throw new Error('seed sem o usuário padrão');
    }
    return { tenant: ICS_TENANT, me, directory, conversations: [], recent: {}, unread: 0 };
  }

  markRead(request: MarkReadRequest): Promise<void> {
    this.marked.push(request);
    return Promise.resolve();
  }

  openDirect(request: OpenDirectRequest): Promise<DirectConversation> {
    return Promise.reject(new Error(`openDirect não roteirizado: ${request.with}`));
  }

  setTyping(request: TypingRequest): void {
    this.typing.push(request);
  }

  connect(session: ConnectRequest): Promise<Bootstrap> {
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
        this.connectHeld = { resolve: () => { resolve(this.bootstrap()); } };
      });
    }
    this.status = 'connected';
    this.emit({ type: 'connection', status: 'connected' });
    return Promise.resolve(this.bootstrap());
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
