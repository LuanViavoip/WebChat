import type {
  AnnouncementBootstrap,
  AnnouncementForAuthor,
  AnnouncementForReader,
  AnnouncementId,
  AnnouncementRevisionRef,
  Capability,
  ChatMessage,
  ClientId,
  Conversation,
  ConversationId,
  ConversationPrefs,
  ConversationPrefsRequest,
  ConversationSummary,
  DirectConversation,
  Directory,
  EditAnnouncementRequest,
  Emoji,
  ForwardAnnouncementRequest,
  GrantLogEntry,
  GroupConversation,
  Ilha,
  IlhaId,
  IsoInstant,
  MessageId,
  MessageReceipts,
  MessageRef,
  MessageStatus,
  PlaybackReport,
  PollTally,
  Presence,
  PublishAnnouncementRequest,
  QuickReply,
  ReactionGroup,
  ReceiptState,
  ReceiptTally,
  ReceiptsPanel,
  SaveQuickReplyRequest,
  ScheduleRequest,
  ScheduledItem,
  SetPresenceRequest,
  StaffUser,
  Tenant,
  TenantId,
  UserId,
  VotePollRequest,
} from '@viavoip/internal-domain';
import type {
  ActivityRequest,
  ComposeActivity,
  CreateGroupRequest,
  DeleteRequest,
  EditRequest,
  ForwardRequest,
  ForwardResult,
  HistoryPage,
  HistoryRequest,
  LeaveGroupRequest,
  MarkReadRequest,
  OpenDirectRequest,
  PinMessageRequest,
  ReactRequest,
  SearchHit,
  SearchRequest,
  SendRequest,
  StarRequest,
  TransportStatus,
  UpdateGroupRequest,
  UploadRequest,
  UploadedMedia,
} from './contract/messaging';
import type { AnnouncementIdRequest, RemindAnnouncementResult } from './contract/announcements';
import type { DeleteQuickReplyRequest } from './contract/quickReplies';
import type { CancelScheduledRequest } from './contract/scheduling';

export * from './contract/announcements';
export * from './contract/messaging';
export * from './contract/polls';
export * from './contract/prefs';
export * from './contract/presence';
export * from './contract/quickReplies';
export * from './contract/scheduling';

/** O tenant e o usuário que pedem a sessão. O servidor valida ambos contra a partição do tenant. */
export type ConnectRequest = { readonly tenantId: TenantId; readonly userId: UserId };

export type Bootstrap = {
  readonly tenant: Tenant;
  /** Com grants. */
  readonly me: StaffUser;
  /** Só do tenant. */
  readonly directory: Directory;
  /** Só as conversas em que `me` participa. */
  readonly conversations: readonly ConversationSummary[];
  readonly recent: Readonly<Record<ConversationId, readonly ChatMessage[]>>;
  /** Total de mensagens não lidas, somando as conversas. */
  readonly unread: number;
  readonly serverNow: IsoInstant;
  readonly firstLoginOfDay: boolean;
  readonly presence: Readonly<Record<UserId, Presence>>;
  readonly prefs: Readonly<Record<ConversationId, ConversationPrefs>>;
  readonly starred: readonly MessageRef[];
  readonly pinnedMessages: Readonly<Record<ConversationId, readonly MessageId[]>>;
  readonly reactions: Readonly<Record<MessageId, readonly ReactionGroup[]>>;
  readonly polls: Readonly<Record<MessageId, PollTally>>;
  readonly quickReplies: readonly QuickReply[];
  readonly scheduled: readonly ScheduledItem[];
  readonly announcements: AnnouncementBootstrap;
};

/** Quem aparece na tela "Entrar como" (mock/dev: o SM real autentica por credencial). Só de um tenant por grupo. */
export type LoginGroup = { readonly tenant: Tenant; readonly users: readonly StaffUser[] };

export type RegisterSupervisorRequest = { readonly name: string; readonly ilhaIds: readonly IlhaId[] };
/** N:N: o agente nasce em ao menos uma ilha (o supervisor precisa supervisionar todas). */
export type RegisterAgentRequest = { readonly name: string; readonly ilhaIds: readonly IlhaId[] };
export type UserRequest = { readonly userId: UserId };
/** N:N: a ilha nasce com ao menos um supervisor. */
export type CreateIlhaRequest = { readonly name: string; readonly supervisorIds: readonly UserId[] };
export type RenameIlhaRequest = { readonly ilhaId: IlhaId; readonly name: string };
/** Acrescenta (assign) ou tira (unassign) UM supervisor da ilha; os outros ficam. */
export type AssignIlhaSupervisorRequest = { readonly ilhaId: IlhaId; readonly supervisorId: UserId };
export type UnassignIlhaSupervisorRequest = AssignIlhaSupervisorRequest;
/** Acrescenta ou tira UM vínculo agente-ilha (mover = acrescentar um e tirar o outro). */
export type AgentIlhaRequest = { readonly userId: UserId; readonly ilhaId: IlhaId };
export type SetGrantRequest = { readonly userId: UserId; readonly capability: Capability; readonly granted: boolean };

/** Por que a sessão caiu. Hoje só a desativação da conta. */
export type SessionEndReason = 'deactivated';

type Scoped = { readonly tenantId: TenantId };

export type ChatEvent =
  | { type: 'connection'; status: TransportStatus }
  | (Scoped & { type: 'message'; message: ChatMessage })
  | (Scoped & {
      type: 'status';
      conversationId: ConversationId;
      messageId: MessageId;
      clientId?: ClientId;
      status: MessageStatus;
    })
  | (Scoped & { type: 'activity'; conversationId: ConversationId; userId: UserId; activity: ComposeActivity })
  | (Scoped & { type: 'read'; conversationId: ConversationId; userId: UserId; upToMessageId: MessageId })
  | (Scoped & { type: 'conversation'; conversation: Conversation })
  | (Scoped & { type: 'conversation-removed'; conversationId: ConversationId })
  | (Scoped & { type: 'grants'; userId: UserId; grants: readonly Capability[] })
  /** Diretório do tenant depois de uma operação aceita (usuários e ilhas). Só vai a usuários ativos do mesmo tenant. */
  | (Scoped & { type: 'directory'; directory: Directory })
  /** O grantLog que ESTE usuário pode ler, completo; só vai a quem lê e só se o que ele enxerga mudou. */
  | (Scoped & { type: 'grantLog'; entries: readonly GrantLogEntry[] })
  /** O servidor encerrou a sessão deste usuário (em todas as abas). Depois disso nenhum método responde. */
  | (Scoped & { type: 'session-ended'; reason: SessionEndReason })
  | (Scoped & { type: 'message-updated'; message: ChatMessage })
  | (Scoped & MessageRef & { type: 'message-hidden' })
  | (Scoped & MessageRef & { type: 'reaction'; userId: UserId; emoji: Emoji | null })
  | (Scoped & MessageRef & { type: 'receipt'; userId: UserId; kind: 'delivered' | 'read'; at: IsoInstant })
  | (Scoped & { type: 'presence'; presence: Presence })
  | (Scoped & { type: 'prefs'; conversationId: ConversationId; prefs: ConversationPrefs })
  | (Scoped & MessageRef & { type: 'star'; starred: boolean })
  | (Scoped & { type: 'pinned-messages'; conversationId: ConversationId; messageIds: readonly MessageId[] })
  | (Scoped & MessageRef & { type: 'poll'; tally: PollTally })
  | (Scoped & { type: 'scheduled'; item: ScheduledItem })
  | (Scoped & { type: 'reminder-due'; item: Extract<ScheduledItem, { kind: 'reminder' }> })
  | (Scoped & { type: 'quick-replies'; items: readonly QuickReply[] })
  | (Scoped & { type: 'announcement'; announcement: AnnouncementForReader; receipt: ReceiptState })
  | (Scoped & { type: 'announcement-authored'; announcement: AnnouncementForAuthor })
  | (Scoped & { type: 'announcement-revoked'; id: AnnouncementId; reason: 'expired' | 'audience' })
  | (Scoped & { type: 'announcement-receipts'; id: AnnouncementId; tally: ReceiptTally })
  | (Scoped & { type: 'announcement-reminder'; id: AnnouncementId });

export type ChatEventHandler = (event: ChatEvent) => void;

export interface ChatTransport {
  connect(request: ConnectRequest): Promise<Bootstrap>;
  disconnect(): void;
  send(request: SendRequest): Promise<void>;
  upload(request: UploadRequest): Promise<UploadedMedia>;
  markRead(request: MarkReadRequest): Promise<void>;
  openDirect(request: OpenDirectRequest): Promise<DirectConversation>;
  createGroup(request: CreateGroupRequest): Promise<GroupConversation>;
  updateGroup(request: UpdateGroupRequest): Promise<GroupConversation>;
  leaveGroup(request: LeaveGroupRequest): Promise<GroupConversation>;
  setActivity(request: ActivityRequest): void;
  subscribe(handler: ChatEventHandler): () => void;
  getStatus(): TransportStatus;
  /**
   * Somente mock/dev: o SM real autentica por credencial e não expõe a lista de usuários.
   * Usuários cadastrados por empresa (estado do servidor, inclusive desativados): a tela "Entrar como".
   */
  loginGroups(): readonly LoginGroup[];

  // Etapa 5. O ator é SEMPRE o usuário da sessão; nenhum request leva ator ou tenant.
  // Operação negada rejeita com `ForbiddenError` (mesma mensagem para "não existe", "outra empresa" e "não pode").
  registerSupervisor(request: RegisterSupervisorRequest): Promise<StaffUser>;
  registerAgent(request: RegisterAgentRequest): Promise<StaffUser>;
  deactivateUser(request: UserRequest): Promise<StaffUser>;
  reactivateUser(request: UserRequest): Promise<StaffUser>;
  createIlha(request: CreateIlhaRequest): Promise<Ilha>;
  renameIlha(request: RenameIlhaRequest): Promise<Ilha>;
  assignIlhaSupervisor(request: AssignIlhaSupervisorRequest): Promise<Ilha>;
  unassignIlhaSupervisor(request: UnassignIlhaSupervisorRequest): Promise<Ilha>;
  addAgentToIlha(request: AgentIlhaRequest): Promise<StaffUser>;
  removeAgentFromIlha(request: AgentIlhaRequest): Promise<StaffUser>;
  setGrant(request: SetGrantRequest): Promise<StaffUser>;
  /** O grantLog que o usuário da sessão pode ler (admin: tudo; supervisor: o das ilhas dele; agente: rejeita). */
  grantLog(): Promise<readonly GrantLogEntry[]>;

  // Mensagens (v1)
  history(request: HistoryRequest): Promise<HistoryPage>;
  react(request: ReactRequest): Promise<void>;
  editMessage(request: EditRequest): Promise<ChatMessage>;
  deleteMessage(request: DeleteRequest): Promise<void>;
  forward(request: ForwardRequest): Promise<ForwardResult>;
  setStar(request: StarRequest): Promise<void>;
  pinMessage(request: PinMessageRequest): Promise<void>;
  messageInfo(request: MessageRef): Promise<MessageReceipts>;
  searchMessages(request: SearchRequest): Promise<readonly SearchHit[]>;

  // Presença e preferências (v1)
  setPresence(request: SetPresenceRequest): Promise<Presence>;
  setConversationPrefs(request: ConversationPrefsRequest): Promise<ConversationPrefs>;

  // Enquete (v1)
  votePoll(request: VotePollRequest): Promise<PollTally>;
  closePoll(request: MessageRef): Promise<void>;

  // Agendada e lembrete (v1)
  schedule(request: ScheduleRequest): Promise<ScheduledItem>;
  cancelScheduled(request: CancelScheduledRequest): Promise<ScheduledItem>;

  // Respostas rápidas (v1)
  saveQuickReply(request: SaveQuickReplyRequest): Promise<QuickReply>;
  deleteQuickReply(request: DeleteQuickReplyRequest): Promise<void>;

  // Avisos (v1)
  publishAnnouncement(request: PublishAnnouncementRequest): Promise<AnnouncementForAuthor>;
  editAnnouncement(request: EditAnnouncementRequest): Promise<AnnouncementForAuthor>;
  markAnnouncementViewed(request: AnnouncementRevisionRef): Promise<ReceiptState>;
  reportPlayback(request: PlaybackReport): Promise<ReceiptState>;
  acknowledgeAnnouncement(request: AnnouncementRevisionRef): Promise<ReceiptState>;
  announcementReceipts(request: AnnouncementIdRequest): Promise<ReceiptsPanel>;
  remindAnnouncement(request: AnnouncementIdRequest): Promise<RemindAnnouncementResult>;
  forwardAnnouncement(request: ForwardAnnouncementRequest): Promise<ForwardResult>;
}
