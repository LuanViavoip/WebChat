import { UploadCanceledError, UploadFailedError } from '../transport/abort';
import {
  asAnnouncementId,
  asIsoInstant,
  asMessageId,
  asQuickReplyId,
  asRevisionNo,
  asScheduledId,
  directConversation,
  type AnnouncementBootstrap,
  type AnnouncementForAuthor,
  type ChatMessage,
  type ConversationId,
  type ConversationPrefs,
  type ConversationPrefsRequest,
  type ConversationSummary,
  type DirectConversation,
  type GrantLogEntry,
  type GroupConversation,
  type Ilha,
  type IlhaId,
  type MessageId,
  type MessageReceipts,
  type MessageRef,
  type MessageStatus,
  type PollTally,
  type Presence,
  type QuickReply,
  type ReactionGroup,
  type ReceiptState,
  type ReceiptsPanel,
  type ScheduledItem,
  type StaffUser,
  type TenantId,
  type UserId,
} from '@viavoip/internal-domain';
import type {
  ActivityRequest,
  AgentIlhaRequest,
  AnnouncementIdRequest,
  AssignIlhaSupervisorRequest,
  Bootstrap,
  CancelScheduledRequest,
  ChatEvent,
  ChatEventHandler,
  ChatTransport,
  ComposeActivity,
  ConnectRequest,
  CreateGroupRequest,
  CreateIlhaRequest,
  DeleteQuickReplyRequest,
  DeleteRequest,
  EditAnnouncementRequest,
  EditRequest,
  ForwardAnnouncementRequest,
  ForwardRequest,
  ForwardResult,
  HistoryPage,
  HistoryRequest,
  LeaveGroupRequest,
  LoginGroup,
  MarkReadRequest,
  OpenDirectRequest,
  PinMessageRequest,
  PlaybackReport,
  PublishAnnouncementRequest,
  ReactRequest,
  RegisterAgentRequest,
  RegisterSupervisorRequest,
  RemindAnnouncementResult,
  RenameIlhaRequest,
  SaveQuickReplyRequest,
  ScheduleRequest,
  SearchHit,
  SearchRequest,
  SendRequest,
  SetGrantRequest,
  SetPresenceRequest,
  StarRequest,
  TransportStatus,
  UnassignIlhaSupervisorRequest,
  UpdateGroupRequest,
  UploadRequest,
  UploadedMedia,
  UserRequest,
  VotePollRequest,
} from '../transport/ChatTransport';
import {
  BV_TENANT,
  bvDirectory,
  DEFAULT_SESSION,
  ICS_ILHAS,
  ICS_TENANT,
  ICS_TENANT_ID,
  ICS_USERS,
  LIVE_CONVERSATION_ID,
  OTHER_CONVERSATION_ID,
  icsDirectory,
} from '../transport/mock/seed';

type OmitTenant<E> = E extends { tenantId: TenantId } ? Omit<E, 'tenantId'> : E;

/** Eventos de teste sem o escopo: tenant e conversa padrão são preenchidos. */
export type ScriptedEvent =
  | { type: 'connection'; status: TransportStatus }
  | { type: 'message'; message: ChatMessage }
  | { type: 'status'; messageId: string; clientId?: string; status: MessageStatus; conversationId?: ConversationId }
  | { type: 'activity'; userId: UserId; activity: ComposeActivity; conversationId?: ConversationId }
  | OmitTenant<Exclude<ChatEvent, { type: 'connection' | 'message' | 'status' | 'activity' }>>;

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

export type ProgrammableMethod =
  | 'createGroup'
  | 'updateGroup'
  | 'leaveGroup'
  | 'history'
  | 'react'
  | 'editMessage'
  | 'deleteMessage'
  | 'forward'
  | 'setStar'
  | 'pinMessage'
  | 'messageInfo'
  | 'searchMessages'
  | 'setPresence'
  | 'setConversationPrefs'
  | 'votePoll'
  | 'closePoll'
  | 'schedule'
  | 'cancelScheduled'
  | 'saveQuickReply'
  | 'deleteQuickReply'
  | 'publishAnnouncement'
  | 'editAnnouncement'
  | 'markAnnouncementViewed'
  | 'reportPlayback'
  | 'acknowledgeAnnouncement'
  | 'announcementReceipts'
  | 'remindAnnouncement'
  | 'forwardAnnouncement';

type MethodArg<K extends ProgrammableMethod> = Parameters<ChatTransport[K]>[0];
type MethodResult<K extends ProgrammableMethod> = Awaited<ReturnType<ChatTransport[K]>>;

type HeldMethodCall = {
  request: unknown;
  fallback: () => unknown;
  resolve: (value: unknown) => void;
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
  readonly typing: ActivityRequest[] = [];
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

  serverNow = asIsoInstant('2026-11-10T12:00:00.000Z');
  firstLoginOfDay = false;
  presence: Record<UserId, Presence> | undefined;
  prefs: Record<ConversationId, ConversationPrefs> = {};
  starred: MessageRef[] = [];
  pinnedMessages: Record<ConversationId, readonly MessageId[]> = {};
  reactions: Record<MessageId, readonly ReactionGroup[]> = {};
  polls: Record<MessageId, PollTally> = {};
  quickReplies: QuickReply[] = [];
  scheduled: ScheduledItem[] = [];
  announcements: AnnouncementBootstrap = { board: [], authored: [] };

  private readonly held: HeldSend[] = [];
  private readonly heldUploads: HeldUpload[] = [];
  private connectHeld: { resolve: () => void } | undefined;
  private status: TransportStatus = 'disconnected';
  private readonly handlers = new Set<ChatEventHandler>();

  private readonly methodCalls = new Map<ProgrammableMethod, unknown[]>();
  private readonly methodResolvers = new Map<ProgrammableMethod, (request: unknown) => unknown>();
  private readonly methodRejections = new Map<ProgrammableMethod, Error>();
  private readonly methodHoldFlags = new Set<ProgrammableMethod>();
  private readonly methodHeld = new Map<ProgrammableMethod, HeldMethodCall[]>();
  private readonly methodEvents = new Map<
    ProgrammableMethod,
    (request: unknown, result: unknown) => ScriptedEvent | ChatEvent
  >();

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

  callsOf<K extends ProgrammableMethod>(method: K): readonly MethodArg<K>[] {
    return (this.methodCalls.get(method) ?? []) as readonly MethodArg<K>[];
  }

  resolveMethod<K extends ProgrammableMethod>(
    method: K,
    valueOrFactory: MethodResult<K> | ((request: MethodArg<K>) => MethodResult<K>),
  ): void {
    this.methodRejections.delete(method);
    this.methodHoldFlags.delete(method);
    const fn =
      typeof valueOrFactory === 'function'
        ? (valueOrFactory as (request: unknown) => unknown)
        : () => valueOrFactory;
    this.methodResolvers.set(method, fn);
  }

  rejectMethod(method: ProgrammableMethod, error: Error): void {
    this.methodHoldFlags.delete(method);
    this.methodRejections.set(method, error);
  }

  holdMethod(method: ProgrammableMethod): void {
    this.methodRejections.delete(method);
    this.methodHoldFlags.add(method);
  }

  heldCallsOf<K extends ProgrammableMethod>(method: K): readonly MethodArg<K>[] {
    return (this.methodHeld.get(method) ?? []).map((entry) => entry.request as MethodArg<K>);
  }

  resolveHeldMethod<K extends ProgrammableMethod>(method: K, value?: MethodResult<K>, index = 0): void {
    const queue = this.methodHeld.get(method);
    const entry = queue?.splice(index, 1)[0];
    if (!entry) {
      return;
    }
    const resolvedValue =
      value !== undefined
        ? value
        : this.methodResolvers.get(method)?.(entry.request) ?? entry.fallback();
    const eventFactory = this.methodEvents.get(method);
    if (eventFactory) {
      this.emit(eventFactory(entry.request, resolvedValue));
    }
    entry.resolve(resolvedValue);
  }

  rejectHeldMethod(
    method: ProgrammableMethod,
    error: Error = new Error(`Falha programada em ${method}`),
    index = 0,
  ): void {
    const queue = this.methodHeld.get(method);
    const entry = queue?.splice(index, 1)[0];
    entry?.reject(error);
  }

  emitOn<K extends ProgrammableMethod>(
    method: K,
    eventOrFactory:
      | ScriptedEvent
      | ChatEvent
      | ((request: MethodArg<K>, result: MethodResult<K>) => ScriptedEvent | ChatEvent),
  ): void {
    const fn =
      typeof eventOrFactory === 'function'
        ? (eventOrFactory as (request: unknown, result: unknown) => ScriptedEvent | ChatEvent)
        : () => eventOrFactory;
    this.methodEvents.set(method, fn);
  }

  private runProgrammed<K extends ProgrammableMethod>(
    method: K,
    request: MethodArg<K>,
    fallback: () => MethodResult<K>,
  ): Promise<MethodResult<K>> {
    const recorded = this.methodCalls.get(method) ?? [];
    recorded.push(request);
    this.methodCalls.set(method, recorded);

    const rejection = this.methodRejections.get(method);
    if (rejection) {
      return Promise.reject(rejection);
    }

    if (this.methodHoldFlags.has(method)) {
      return new Promise<MethodResult<K>>((resolve, reject) => {
        const queue = this.methodHeld.get(method) ?? [];
        queue.push({
          request,
          fallback,
          resolve: (value) => {
            resolve(value as MethodResult<K>);
          },
          reject,
        });
        this.methodHeld.set(method, queue);
      });
    }

    const resolver = this.methodResolvers.get(method);
    const result = (resolver ? resolver(request) : fallback()) as MethodResult<K>;
    const eventFactory = this.methodEvents.get(method);
    if (eventFactory) {
      this.emit(eventFactory(request, result));
    }
    return Promise.resolve(result);
  }

  private scope(event: ScriptedEvent | ChatEvent): ChatEvent {
    if (event.type === 'connection' || 'tenantId' in event) {
      return event;
    }
    const tenantId = DEFAULT_SESSION.tenantId;
    if (event.type === 'status' || event.type === 'activity') {
      return { ...event, tenantId, conversationId: event.conversationId ?? LIVE_CONVERSATION_ID };
    }
    return { ...event, tenantId };
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
    const presence: Record<UserId, Presence> =
      this.presence ??
      Object.fromEntries(
        Object.values(directory.users).map((user) => [
          user.id,
          { userId: user.id, online: true, lastSeenAt: null, status: { kind: 'available' } } satisfies Presence,
        ]),
      );
    return {
      tenant: ICS_TENANT,
      me,
      directory,
      conversations: [...conversations, ...this.extraConversations],
      recent: { ...this.recent },
      unread: 0,
      serverNow: this.serverNow,
      firstLoginOfDay: this.firstLoginOfDay,
      presence,
      prefs: { ...this.prefs },
      starred: [...this.starred],
      pinnedMessages: { ...this.pinnedMessages },
      reactions: { ...this.reactions },
      polls: { ...this.polls },
      quickReplies: [...this.quickReplies],
      scheduled: [...this.scheduled],
      announcements: this.announcements,
    };
  }

  createGroup(request: CreateGroupRequest): Promise<GroupConversation> {
    if (!this.methodResolvers.has('createGroup') && !this.methodRejections.has('createGroup') && !this.methodHoldFlags.has('createGroup')) {
      return Promise.reject(new Error('Grupo não configurado no transporte de teste'));
    }
    return this.runProgrammed('createGroup', request, () => {
      throw new Error('Grupo não configurado no transporte de teste');
    });
  }

  updateGroup(request: UpdateGroupRequest): Promise<GroupConversation> {
    if (!this.methodResolvers.has('updateGroup') && !this.methodRejections.has('updateGroup') && !this.methodHoldFlags.has('updateGroup')) {
      return Promise.reject(new Error('Grupo não configurado no transporte de teste'));
    }
    return this.runProgrammed('updateGroup', request, () => {
      throw new Error('Grupo não configurado no transporte de teste');
    });
  }

  leaveGroup(request: LeaveGroupRequest): Promise<GroupConversation> {
    if (!this.methodResolvers.has('leaveGroup') && !this.methodRejections.has('leaveGroup') && !this.methodHoldFlags.has('leaveGroup')) {
      return Promise.reject(new Error('Grupo não configurado no transporte de teste'));
    }
    return this.runProgrammed('leaveGroup', request, () => {
      throw new Error('Grupo não configurado no transporte de teste');
    });
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

  setActivity(request: ActivityRequest): void {
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

  unassignIlhaSupervisor(request: UnassignIlhaSupervisorRequest): Promise<Ilha> {
    return this.admin('unassignIlhaSupervisor', request, () => this.ilhaOrThrow(request.ilhaId));
  }

  addAgentToIlha(request: AgentIlhaRequest): Promise<StaffUser> {
    return this.admin('addAgentToIlha', request, () => this.userOrThrow(request.userId));
  }

  removeAgentFromIlha(request: AgentIlhaRequest): Promise<StaffUser> {
    return this.admin('removeAgentFromIlha', request, () => this.userOrThrow(request.userId));
  }

  setGrant(request: SetGrantRequest): Promise<StaffUser> {
    return this.admin('setGrant', request, () => this.userOrThrow(request.userId));
  }

  grantLog(): Promise<readonly GrantLogEntry[]> {
    return this.admin('grantLog', undefined, () => this.grantLogEntries);
  }

  history(request: HistoryRequest): Promise<HistoryPage> {
    return this.runProgrammed('history', request, () => ({ messages: [], hasMore: false }));
  }

  react(request: ReactRequest): Promise<void> {
    return this.runProgrammed('react', request, () => undefined);
  }

  editMessage(request: EditRequest): Promise<ChatMessage> {
    return this.runProgrammed('editMessage', request, () => ({
      id: request.messageId,
      tenantId: ICS_TENANT_ID,
      conversationId: request.conversationId,
      authorId: this.asUser ?? DEFAULT_SESSION.userId,
      author: { id: this.asUser ?? DEFAULT_SESSION.userId, name: 'Você' },
      timestamp: this.serverNow,
      status: 'sent',
      type: 'text',
      text: request.text,
      editedAt: this.serverNow,
    }));
  }

  deleteMessage(request: DeleteRequest): Promise<void> {
    return this.runProgrammed('deleteMessage', request, () => undefined);
  }

  forward(request: ForwardRequest): Promise<ForwardResult> {
    return this.runProgrammed('forward', request, () => ({
      perTarget: request.targets.map((target) => ({ target, outcome: 'sent' })),
    }));
  }

  setStar(request: StarRequest): Promise<void> {
    return this.runProgrammed('setStar', request, () => undefined);
  }

  pinMessage(request: PinMessageRequest): Promise<void> {
    return this.runProgrammed('pinMessage', request, () => undefined);
  }

  messageInfo(request: MessageRef): Promise<MessageReceipts> {
    return this.runProgrammed('messageInfo', request, () => ({
      messageId: request.messageId,
      recipients: [],
    }));
  }

  searchMessages(request: SearchRequest): Promise<readonly SearchHit[]> {
    return this.runProgrammed('searchMessages', request, () => []);
  }

  setPresence(request: SetPresenceRequest): Promise<Presence> {
    return this.runProgrammed('setPresence', request, () => ({
      userId: this.asUser ?? DEFAULT_SESSION.userId,
      online: true,
      lastSeenAt: null,
      status:
        request.status === 'available'
          ? { kind: 'available' }
          : request.status === 'pause'
            ? { kind: 'pause', reason: request.reason, since: this.serverNow }
            : { kind: 'away', since: this.serverNow },
    }));
  }

  setConversationPrefs(request: ConversationPrefsRequest): Promise<ConversationPrefs> {
    return this.runProgrammed('setConversationPrefs', request, () => ({
      pinnedAt: request.pinned ? this.serverNow : null,
      archived: request.archived ?? false,
      mutedUntil: request.mutedUntil ?? null,
    }));
  }

  votePoll(request: VotePollRequest): Promise<PollTally> {
    return this.runProgrammed('votePoll', request, () => ({
      totals: {},
      voters: {},
      closed: false,
    }));
  }

  closePoll(request: MessageRef): Promise<void> {
    return this.runProgrammed('closePoll', request, () => undefined);
  }

  schedule(request: ScheduleRequest): Promise<ScheduledItem> {
    return this.runProgrammed('schedule', request, () => {
      const id = asScheduledId(`sched-${String(this.callsOf('schedule').length)}`);
      const authorId = this.asUser ?? DEFAULT_SESSION.userId;
      if (request.kind === 'message') {
        return {
          id,
          tenantId: ICS_TENANT_ID,
          authorId,
          state: { phase: 'pending' },
          kind: 'message',
          conversationId: request.conversationId,
          text: request.text,
          sendAt: request.sendAt,
        };
      }
      return {
        id,
        tenantId: ICS_TENANT_ID,
        authorId,
        state: { phase: 'pending' },
        kind: 'reminder',
        note: request.note,
        at: request.at,
        ref: request.ref ?? null,
      };
    });
  }

  cancelScheduled(request: CancelScheduledRequest): Promise<ScheduledItem> {
    return this.runProgrammed('cancelScheduled', request, () => ({
      id: request.id,
      tenantId: ICS_TENANT_ID,
      authorId: this.asUser ?? DEFAULT_SESSION.userId,
      state: { phase: 'canceled', at: this.serverNow },
      kind: 'reminder',
      note: '',
      at: this.serverNow,
      ref: null,
    }));
  }

  saveQuickReply(request: SaveQuickReplyRequest): Promise<QuickReply> {
    return this.runProgrammed('saveQuickReply', request, () => ({
      id: request.id ?? asQuickReplyId(`qr-${String(this.callsOf('saveQuickReply').length)}`),
      tenantId: ICS_TENANT_ID,
      shortcut: request.shortcut,
      text: request.text,
      scope: request.scope,
      updatedAt: this.serverNow,
    }));
  }

  deleteQuickReply(request: DeleteQuickReplyRequest): Promise<void> {
    return this.runProgrammed('deleteQuickReply', request, () => undefined);
  }

  publishAnnouncement(request: PublishAnnouncementRequest): Promise<AnnouncementForAuthor> {
    return this.runProgrammed('publishAnnouncement', request, () => {
      const rev = asRevisionNo(1);
      const authorId = this.asUser ?? DEFAULT_SESSION.userId;
      return {
        id: asAnnouncementId(`ann-${String(this.callsOf('publishAnnouncement').length)}`),
        tenantId: ICS_TENANT_ID,
        authorId,
        audience: request.audience,
        audienceUserIds: [],
        delivery: request.delivery,
        requiresAck: request.requiresAck,
        pinned: request.pinned,
        publishedAt: this.serverNow,
        expiresAt: request.expiresAt,
        revisions: [
          {
            no: rev,
            content: request.content,
            editedAt: this.serverNow,
            editedBy: authorId,
            material: true,
          },
        ],
        tally: {
          revision: rev,
          viewed: [],
          played: [],
          acknowledged: [],
          pending: [],
          lastReminderAt: null,
        },
      };
    });
  }

  editAnnouncement(request: EditAnnouncementRequest): Promise<AnnouncementForAuthor> {
    return this.runProgrammed('editAnnouncement', request, () => {
      const rev = asRevisionNo(1);
      const authorId = this.asUser ?? DEFAULT_SESSION.userId;
      return {
        id: request.id,
        tenantId: ICS_TENANT_ID,
        authorId,
        audience: request.edit.kind === 'audience' ? request.edit.audience : { kind: 'all' },
        audienceUserIds: [],
        delivery: { kind: 'board' },
        requiresAck: false,
        pinned: request.edit.kind === 'pin' ? request.edit.pinned : false,
        publishedAt: this.serverNow,
        expiresAt: request.edit.kind === 'expiry' ? request.edit.expiresAt : null,
        revisions: [
          {
            no: rev,
            content:
              request.edit.kind === 'content'
                ? request.edit.content
                : { title: 'Aviso', body: '', media: { kind: 'none' } },
            editedAt: this.serverNow,
            editedBy: authorId,
            material: request.edit.kind === 'content' ? request.edit.material : false,
          },
        ],
        tally: {
          revision: rev,
          viewed: [],
          played: [],
          acknowledged: [],
          pending: [],
          lastReminderAt: null,
        },
      };
    });
  }

  markAnnouncementViewed(request: Parameters<ChatTransport['markAnnouncementViewed']>[0]): Promise<ReceiptState> {
    return this.runProgrammed('markAnnouncementViewed', request, () => ({
      phase: 'viewed',
      viewedAt: this.serverNow,
      maxPositionMs: 0,
    }));
  }

  reportPlayback(request: PlaybackReport): Promise<ReceiptState> {
    return this.runProgrammed('reportPlayback', request, () =>
      request.ended && request.durationMs > 0 && request.maxPositionMs * 100 >= request.durationMs * 95
        ? { phase: 'played', viewedAt: this.serverNow, playedAt: this.serverNow }
        : { phase: 'viewed', viewedAt: this.serverNow, maxPositionMs: request.maxPositionMs },
    );
  }

  acknowledgeAnnouncement(request: Parameters<ChatTransport['acknowledgeAnnouncement']>[0]): Promise<ReceiptState> {
    return this.runProgrammed('acknowledgeAnnouncement', request, () => ({
      phase: 'acknowledged',
      viewedAt: this.serverNow,
      playedAt: null,
      acknowledgedAt: this.serverNow,
    }));
  }

  announcementReceipts(request: AnnouncementIdRequest): Promise<ReceiptsPanel> {
    return this.runProgrammed('announcementReceipts', request, () => ({
      revision: asRevisionNo(1),
      viewed: [],
      played: [],
      acknowledged: [],
      pending: [],
      lastReminderAt: null,
      byIlha: [],
      history: [],
    }));
  }

  remindAnnouncement(request: AnnouncementIdRequest): Promise<RemindAnnouncementResult> {
    return this.runProgrammed('remindAnnouncement', request, () => ({ reminded: 0 }));
  }

  forwardAnnouncement(request: ForwardAnnouncementRequest): Promise<ForwardResult> {
    return this.runProgrammed('forwardAnnouncement', request, () => ({
      perTarget: request.targets.map((target) => ({ target, outcome: 'sent' })),
    }));
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

export { asMessageId };
