import type {
  Conversation,
  ConversationId,
  ConversationSummary,
  DirectConversation,
} from '../domain/conversation';
import type { Capability } from '../domain/capabilities';
import type { Directory, StaffUser, UserId } from '../domain/identity';
import type { ChatMessage, MessageStatus } from '../domain/message';
import type { Tenant, TenantId } from '../domain/tenant';

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
  | (Scoped & { type: 'grants'; userId: UserId; grants: readonly Capability[] });

export type ChatEventHandler = (event: ChatEvent) => void;

export interface ChatTransport {
  connect(request: ConnectRequest): Promise<Bootstrap>;
  disconnect(): void;
  send(request: SendRequest): Promise<void>;
  upload(request: UploadRequest): Promise<UploadedMedia>;
  markRead(request: MarkReadRequest): Promise<void>;
  openDirect(request: OpenDirectRequest): Promise<DirectConversation>;
  setTyping(request: TypingRequest): void;
  subscribe(handler: ChatEventHandler): () => void;
  getStatus(): TransportStatus;
}
