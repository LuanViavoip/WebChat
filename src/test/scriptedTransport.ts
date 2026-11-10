import type {
  ChatEvent,
  ChatEventHandler,
  ChatTransport,
  ConnectSession,
  SendRequest,
  TransportStatus,
} from '../transport/ChatTransport';

type HeldSend = {
  request: SendRequest;
  resolve: () => void;
  reject: (error: Error) => void;
};

export class ScriptedTransport implements ChatTransport {
  readonly sent: SendRequest[] = [];
  lastSession: ConnectSession | undefined;
  failConnect = false;
  failSend = false;
  holdSend = false;
  private readonly held: HeldSend[] = [];
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
    this.status = 'connected';
    this.emit({ type: 'connection', status: 'connected' });
    return Promise.resolve();
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

  rejectHeld(error: Error = new Error('Falha tardia de envio')): void {
    const pending = this.held.splice(0, this.held.length);
    for (const item of pending) {
      item.reject(error);
    }
  }
}
