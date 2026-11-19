import type {
  Conversation,
  ConversationId,
  ConversationSummary,
  DirectConversation,
  GroupConversation,
} from '@viavoip/internal-domain';
import type { Capability } from '@viavoip/internal-domain';
import type { GrantLogEntry } from '@viavoip/internal-domain';
import type { Directory, Ilha, IlhaId, StaffUser, UserId } from '@viavoip/internal-domain';
import type { ChatMessage, MessageStatus } from '@viavoip/internal-domain';
import type { Tenant, TenantId } from '@viavoip/internal-domain';

export type TransportStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

export type OutboundPayload =
  | { type: 'text'; text: string }
  | { type: 'image'; caption?: string; mimeType: string; url: string }
  | { type: 'audio'; mimeType: string; url: string; durationMs?: number }
  | { type: 'video'; caption?: string; mimeType: string; url: string }
  | { type: 'document'; fileName: string; mimeType: string; url: string; sizeBytes?: number }
  | { type: 'sticker'; mimeType: string; url: string };

export type SendRequest = {
  conversationId: ConversationId;
  clientId: string;
  payload: OutboundPayload;
};

export type UploadProgress = { loaded: number; total: number };

export type UploadRequest = {
  conversationId: ConversationId;
  clientId: string;
  file: Blob;
  fileName: string;
  mimeType: string;
  signal: AbortSignal;
  onProgress: (progress: UploadProgress) => void;
};

export type UploadedMedia = { url: string };

export type MarkReadRequest = { conversationId: ConversationId; upToMessageId: string };
export type CreateGroupRequest = { readonly clientId: string; readonly title: string; readonly memberIds: readonly UserId[]; readonly ilhaId: IlhaId | null };
export type UpdateGroupRequest = { readonly conversationId: ConversationId; readonly title?: string; readonly add?: readonly UserId[]; readonly remove?: readonly UserId[] };
export type LeaveGroupRequest = { readonly conversationId: ConversationId };
export type OpenDirectRequest = { with: UserId };
export type TypingRequest = { conversationId: ConversationId; isTyping: boolean };

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
      messageId: string;
      clientId?: string;
      status: MessageStatus;
    })
  | (Scoped & { type: 'typing'; conversationId: ConversationId; userId: UserId; isTyping: boolean })
  | (Scoped & { type: 'read'; conversationId: ConversationId; userId: UserId; upToMessageId: string })
  | (Scoped & { type: 'conversation'; conversation: Conversation })
  | (Scoped & { type: 'conversation-removed'; conversationId: ConversationId })
  | (Scoped & { type: 'grants'; userId: UserId; grants: readonly Capability[] })
  /** Diretório do tenant depois de uma operação aceita (usuários e ilhas). Só vai a usuários ativos do mesmo tenant. */
  | (Scoped & { type: 'directory'; directory: Directory })
  /** O grantLog que ESTE usuário pode ler, completo; só vai a quem lê e só se o que ele enxerga mudou. */
  | (Scoped & { type: 'grantLog'; entries: readonly GrantLogEntry[] })
  /** O servidor encerrou a sessão deste usuário (em todas as abas). Depois disso nenhum método responde. */
  | (Scoped & { type: 'session-ended'; reason: SessionEndReason });

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
  setTyping(request: TypingRequest): void;
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
}
