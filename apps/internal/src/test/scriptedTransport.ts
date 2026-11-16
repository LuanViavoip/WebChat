import { UploadCanceledError, UploadFailedError } from '../transport/abort';
import { directConversation, type ConversationId, type ConversationSummary, type DirectConversation } from '@viavoip/internal-domain';
import type { ChatMessage, MessageStatus } from '@viavoip/internal-domain';
import type { GrantLogEntry } from '@viavoip/internal-domain';
import type { Ilha, IlhaId, StaffUser, UserId } from '@viavoip/internal-domain';
import type {
  Bootstrap,
  ChatEvent,
  ChatEventHandler,
  ChatTransport,
  ConnectRequest,
  AssignIlhaSupervisorRequest,
  CreateIlhaRequest,
  LoginGroup,
  MarkReadRequest,
  MoveAgentRequest,
  RegisterAgentRequest,
  RegisterSupervisorRequest,
  RenameIlhaRequest,
  UserRequest,
  OpenDirectRequest,
  SendRequest,
  SetGrantRequest,
  TransportStatus,
  TypingRequest,
  UploadedMedia,
  UploadRequest,
} from '../transport/ChatTransport';
import {
  BV_TENANT,
  bvDirectory,
  DEFAULT_SESSION,
  ICS_ILHAS,
  ICS_TENANT,
  ICS_USERS,
  LIVE_CONVERSATION_ID,
  OTHER_CONVERSATION_ID,
  icsDirectory,
} from '../transport/mock/seed';

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

/** Uma chamada de administração recebida pelo transporte de teste. */
export type AdminCall = { readonly method: string; readonly request: unknown };

export class ScriptedTransport implements ChatTransport {
  /** Ações de administração chamadas pela sessão, em ordem. */
  readonly adminCalls: AdminCall[] = [];
  /** Se definido, toda ação de administração rejeita com este erro. */
  adminError: Error | undefined;
  /** O que `grantLog()` devolve. */
  grantLogEntries: readonly GrantLogEntry[] = [];
  /** Se definido, `connect` rejeita com este erro (ex.: conta desativada). */
  connectError: Error | undefined;
  readonly sent: SendRequest[] = [];
  readonly uploads: UploadRequest[] = [];
  lastSession: ConnectRequest | undefined;
  /** Quem o Bootstrap devolve como `me` (padrão: o usuário da seed). Só para testes de UI de outros papéis. */
  asUser: UserId | undefined;
  readonly marked: MarkReadRequest[] = [];
  readonly typing: TypingRequest[] = [];
  failConnect = false;
  failSend = false;
  holdSend = false;
  holdConnect = false;
  holdUpload = false;
  failUpload = false;
  /** Mensagens que o "servidor" devolve no Bootstrap (por conversa), como em uma reconexão. */
  recent: Record<string, readonly ChatMessage[]> = {};
  /** Quem a próxima `openDirect` abre falha com este erro, se definido. */
  openDirectError: Error | undefined;
  /** Resposta forçada do `openDirect` (para testar conversa de outro tenant ou sem mim). */
  openDirectResult: DirectConversation | undefined;
  /** Conversas a mais no Bootstrap (ex.: uma "vazada" de outro tenant). */
  extraConversations: ConversationSummary[] = [];
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
    const me = directory.users[this.asUser ?? DEFAULT_SESSION.userId];
    if (!me) {
      throw new Error('seed sem o usuário padrão');
    }
    const conversations: ConversationSummary[] = [LIVE_CONVERSATION_ID, OTHER_CONVERSATION_ID].map((id) => {
      const other = id === LIVE_CONVERSATION_ID ? ICS_USERS.bruno : ICS_USERS.camila;
      const target = directory.users[other];
      const built = target ? directConversation(me, target) : undefined;
      if (!built?.ok) {
        throw new Error('seed sem a direta padrão');
      }
      return { id, conversation: built.value, lastActivityAt: '2026-11-10T11:00:00.000Z', unread: 0 };
    });
    return { tenant: ICS_TENANT, me, directory, conversations: [...conversations, ...this.extraConversations], recent: { ...this.recent }, unread: 0 };
  }

  markRead(request: MarkReadRequest): Promise<void> {
    this.marked.push(request);
    return Promise.resolve();
  }

  openDirect(request: OpenDirectRequest): Promise<DirectConversation> {
    if (this.openDirectError) {
      return Promise.reject(this.openDirectError);
    }
    if (this.openDirectResult) {
      return Promise.resolve(this.openDirectResult);
    }
    const directory = icsDirectory();
    const me = directory.users[DEFAULT_SESSION.userId];
    const target = directory.users[request.with];
    const built = me && target ? directConversation(me, target) : undefined;
    return built?.ok ? Promise.resolve(built.value) : Promise.reject(new Error(`openDirect inválido: ${request.with}`));
  }

  setTyping(request: TypingRequest): void {
    this.typing.push(request);
  }

  loginGroups(): readonly LoginGroup[] {
    const groups = [
      { tenant: ICS_TENANT, directory: icsDirectory() },
      { tenant: BV_TENANT, directory: bvDirectory() },
    ];
    return groups.map(({ tenant, directory }) => ({ tenant, users: Object.values(directory.users) }));
  }

  private admin<T>(method: string, request: unknown, result: () => T): Promise<T> {
    this.adminCalls.push({ method, request });
    return this.adminError ? Promise.reject(this.adminError) : Promise.resolve(result());
  }

  private userOrThrow(id: UserId): StaffUser {
    const found = icsDirectory().users[id];
    if (!found) {
      throw new Error(`usuário fora da seed: ${id}`);
    }
    return found;
  }

  private ilhaOrThrow(id: IlhaId): Ilha {
    const found = icsDirectory().ilhas[id];
    if (!found) {
      throw new Error(`ilha fora da seed: ${id}`);
    }
    return found;
  }

  registerSupervisor(request: RegisterSupervisorRequest): Promise<StaffUser> {
    return this.admin('registerSupervisor', request, () => this.userOrThrow(ICS_USERS.carla));
  }

  registerAgent(request: RegisterAgentRequest): Promise<StaffUser> {
    return this.admin('registerAgent', request, () => this.userOrThrow(ICS_USERS.ana));
  }

  deactivateUser(request: UserRequest): Promise<StaffUser> {
    return this.admin('deactivateUser', request, () => this.userOrThrow(request.userId));
  }

  reactivateUser(request: UserRequest): Promise<StaffUser> {
    return this.admin('reactivateUser', request, () => this.userOrThrow(request.userId));
  }

  createIlha(request: CreateIlhaRequest): Promise<Ilha> {
    return this.admin('createIlha', request, () => this.ilhaOrThrow(ICS_ILHAS.norte));
  }

  renameIlha(request: RenameIlhaRequest): Promise<Ilha> {
    return this.admin('renameIlha', request, () => this.ilhaOrThrow(request.ilhaId));
  }

  assignIlhaSupervisor(request: AssignIlhaSupervisorRequest): Promise<Ilha> {
    return this.admin('assignIlhaSupervisor', request, () => this.ilhaOrThrow(request.ilhaId));
  }

  moveAgent(request: MoveAgentRequest): Promise<StaffUser> {
    return this.admin('moveAgent', request, () => this.userOrThrow(request.userId));
  }

  setGrant(request: SetGrantRequest): Promise<StaffUser> {
    return this.admin('setGrant', request, () => this.userOrThrow(request.userId));
  }

  grantLog(): Promise<readonly GrantLogEntry[]> {
    return this.admin('grantLog', undefined, () => this.grantLogEntries);
  }

  connect(session: ConnectRequest): Promise<Bootstrap> {
    this.lastSession = session;
    if (this.connectError) {
      this.status = 'error';
      this.emit({ type: 'connection', status: 'error' });
      return Promise.reject(this.connectError);
    }
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
