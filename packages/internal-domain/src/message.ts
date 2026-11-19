import type { ConversationId } from './conversation';
import type { AnnouncementId, ClientId, IsoInstant, MessageId, PollOptionId } from './ids';
import type { UserId } from './identity';
import type { TenantId } from './tenant';

export type MessageStatus = 'sending' | 'sent' | 'delivered' | 'read' | 'error';

/** Nome para exibição (snapshot). Quem é o autor de verdade é `authorId`. */
export type MessageAuthor = {
  readonly id: string;
  readonly name: string;
};

export type ReplyRef = {
  readonly messageId: MessageId;
  readonly authorId: UserId;
  /** Fotografia mínima para o balão citado. O servidor zera quando a original é apagada para todos. */
  readonly quoted:
    | { readonly state: 'available'; readonly kind: MessageKind; readonly excerpt: string }
    | { readonly state: 'deleted' };
};

/** Só o selo de encaminhada. Não leva autor nem conversa de origem (igual ao WhatsApp). */
export type ForwardMark = { readonly times: number };

export type MessageBase = {
  readonly id: MessageId;
  readonly tenantId: TenantId;
  readonly conversationId: ConversationId;
  readonly clientId?: ClientId;
  readonly authorId: UserId;
  readonly author: MessageAuthor;
  readonly timestamp: string;
  readonly status: MessageStatus;
  readonly replyTo?: ReplyRef;
  readonly forwarded?: ForwardMark;
  readonly mentions?: readonly UserId[];
  readonly editedAt?: IsoInstant;
};

export type TextMessage = MessageBase & {
  readonly type: 'text';
  readonly text: string;
};

export type ImageMessage = MessageBase & {
  readonly type: 'image';
  readonly caption?: string;
  readonly mimeType: string;
  readonly url: string;
};

export type AudioMessage = MessageBase & {
  readonly type: 'audio';
  readonly mimeType: string;
  readonly url: string;
  readonly durationMs?: number;
  readonly waveform?: readonly number[];
};

export type VideoMessage = MessageBase & {
  readonly type: 'video';
  readonly caption?: string;
  readonly mimeType: string;
  readonly url: string;
};

export type DocumentMessage = MessageBase & {
  readonly type: 'document';
  readonly fileName: string;
  readonly mimeType: string;
  readonly url: string;
  readonly sizeBytes?: number;
};

export type StickerMessage = MessageBase & {
  readonly type: 'sticker';
  readonly mimeType: string;
  readonly url: string;
};

export type PollOption = { readonly id: PollOptionId; readonly text: string };

export type PollMessage = MessageBase & {
  readonly type: 'poll';
  readonly question: string;
  readonly options: readonly [PollOption, PollOption, ...PollOption[]];
  readonly multiple: boolean;
  readonly closedAt: IsoInstant | null;
};

/** Aviso encaminhado: SÓ a referência (v2.2 §2.3). O conteúdo é buscado e mostrado se can(read). */
export type AnnouncementRefMessage = MessageBase & {
  readonly type: 'announcement';
  readonly announcementId: AnnouncementId;
};

/** Apagada para todos: o conteúdo sai do armazenamento. Não sobra texto, url, legenda nem nome de arquivo. */
export type DeletedMessage = Omit<MessageBase, 'replyTo' | 'mentions' | 'editedAt'> & {
  readonly type: 'deleted';
  readonly deletedAt: IsoInstant;
};

export type SystemMessage = Omit<MessageBase, 'authorId' | 'author'> & {
  readonly type: 'system';
  readonly actorId: UserId;
  readonly authorId?: never;
  readonly author?: never;
  readonly action: 'created' | 'renamed' | 'added' | 'removed';
  readonly text: string;
};

export type ChatMessage =
  | SystemMessage
  | TextMessage
  | ImageMessage
  | AudioMessage
  | VideoMessage
  | DocumentMessage
  | StickerMessage
  | PollMessage
  | AnnouncementRefMessage
  | DeletedMessage;

export type MessageKind = ChatMessage['type'];

export function isTextMessage(message: ChatMessage): message is TextMessage {
  return message.type === 'text';
}

export function previewOf(message: ChatMessage): string {
  switch (message.type) {
    case 'text':
    case 'system':
      return message.text;
    case 'image':
      return message.caption || 'Foto';
    case 'audio':
      return 'Áudio';
    case 'video':
      return message.caption || 'Vídeo';
    case 'document':
      return message.fileName;
    case 'sticker':
      return 'Figurinha';
    case 'poll':
      return `📊 ${message.question}`;
    case 'announcement':
      return 'Aviso encaminhado';
    case 'deleted':
      return 'Mensagem apagada';
    default: {
      const exhaustive: never = message;
      return exhaustive;
    }
  }
}
