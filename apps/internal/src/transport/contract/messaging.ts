import type {
  ChatMessage,
  ClientId,
  ConversationId,
  DeleteScope,
  Emoji,
  IlhaId,
  IsoInstant,
  MessageId,
  MessageKind,
  MessageReceipts,
  MessageRef,
  UserId,
} from '@viavoip/internal-domain';

export type { MessageReceipts, MessageRef };

export type TransportStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

export type OutboundPayload =
  | { readonly type: 'text'; readonly text: string }
  | { readonly type: 'image'; readonly caption?: string; readonly mimeType: string; readonly url: string }
  | {
      readonly type: 'audio';
      readonly mimeType: string;
      readonly url: string;
      readonly durationMs?: number;
      readonly waveform?: readonly number[];
    }
  | { readonly type: 'video'; readonly caption?: string; readonly mimeType: string; readonly url: string }
  | {
      readonly type: 'document';
      readonly fileName: string;
      readonly mimeType: string;
      readonly url: string;
      readonly sizeBytes?: number;
    }
  | { readonly type: 'sticker'; readonly mimeType: string; readonly url: string }
  | { readonly type: 'poll'; readonly question: string; readonly options: readonly string[]; readonly multiple: boolean };

export type SendRequest = {
  readonly conversationId: ConversationId;
  readonly clientId: ClientId;
  readonly payload: OutboundPayload;
  readonly replyTo?: MessageId;
  readonly mentions?: readonly UserId[];
};

export type UploadProgress = { readonly loaded: number; readonly total: number };

export type UploadTarget =
  | { readonly kind: 'conversation'; readonly conversationId: ConversationId }
  | { readonly kind: 'announcement-draft' };

export type UploadRequest = {
  readonly conversationId?: ConversationId;
  readonly target?: UploadTarget;
  readonly clientId: string;
  readonly file: Blob;
  readonly fileName: string;
  readonly mimeType: string;
  readonly signal: AbortSignal;
  readonly onProgress: (progress: UploadProgress) => void;
};

export type UploadedMedia = { readonly url: string };

export type MarkReadRequest = { readonly conversationId: ConversationId; readonly upToMessageId: string };
export type CreateGroupRequest = {
  readonly clientId: string;
  readonly title: string;
  readonly memberIds: readonly UserId[];
  readonly ilhaId: IlhaId | null;
};
export type UpdateGroupRequest = {
  readonly conversationId: ConversationId;
  readonly title?: string;
  readonly add?: readonly UserId[];
  readonly remove?: readonly UserId[];
};
export type LeaveGroupRequest = { readonly conversationId: ConversationId };
export type OpenDirectRequest = { readonly with: UserId };
export type ComposeActivity = 'idle' | 'typing' | 'recording-audio';
export type ActivityRequest = { readonly conversationId: ConversationId; readonly activity: ComposeActivity };

export type HistoryRequest = {
  readonly conversationId: ConversationId;
  readonly before?: MessageId;
  readonly limit: number;
  readonly kinds?: readonly MessageKind[];
};

export type HistoryPage = {
  readonly messages: readonly ChatMessage[];
  readonly hasMore: boolean;
};

export type ReactRequest = MessageRef & { readonly emoji: Emoji | null };
export type EditRequest = MessageRef & { readonly text: string };
export type DeleteRequest = MessageRef & { readonly scope: DeleteScope };
export type ForwardRequest = {
  readonly sources: readonly [MessageRef, ...MessageRef[]];
  readonly targets: readonly [ConversationId, ...ConversationId[]];
  readonly clientId: ClientId;
};
export type ForwardResult = {
  readonly perTarget: readonly { readonly target: ConversationId; readonly outcome: 'sent' | 'denied' }[];
};
export type StarRequest = MessageRef & { readonly starred: boolean };
export type PinMessageRequest = MessageRef & { readonly pinned: boolean };
export type SearchRequest = {
  readonly query: string;
  readonly conversationId?: ConversationId;
  readonly limit: number;
};
export type SearchHit = MessageRef & { readonly excerpt: string; readonly at: IsoInstant };
