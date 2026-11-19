import type { ConversationId } from './conversation';
import type { UserId } from './identity';
import type { TenantId } from './tenant';

export type MessageStatus = 'sending' | 'sent' | 'delivered' | 'read' | 'error';

export type MessageKind = 'text' | 'image' | 'audio' | 'video' | 'document' | 'sticker';

/** Nome para exibição (snapshot). Quem é o autor de verdade é `authorId`. */
export type MessageAuthor = {
  id: string;
  name: string;
};

type MessageBase = {
  id: string;
  tenantId: TenantId;
  conversationId: ConversationId;
  clientId?: string;
  authorId: UserId;
  author: MessageAuthor;
  timestamp: string;
  status: MessageStatus;
};

export type TextMessage = MessageBase & {
  type: 'text';
  text: string;
};

export type ImageMessage = MessageBase & {
  type: 'image';
  caption?: string;
  mimeType: string;
  url: string;
};

export type AudioMessage = MessageBase & {
  type: 'audio';
  mimeType: string;
  url: string;
  durationMs?: number;
};

export type VideoMessage = MessageBase & {
  type: 'video';
  caption?: string;
  mimeType: string;
  url: string;
};

export type DocumentMessage = MessageBase & {
  type: 'document';
  fileName: string;
  mimeType: string;
  url: string;
  sizeBytes?: number;
};

export type StickerMessage = MessageBase & {
  type: 'sticker';
  mimeType: string;
  url: string;
};

export type SystemMessage = Omit<MessageBase, 'authorId' | 'author'> & {
  type: 'system';
  actorId: UserId;
  authorId?: never;
  author?: never;
  action: 'created' | 'renamed' | 'added' | 'removed';
  text: string;
};

export type ChatMessage =
  | SystemMessage
  | TextMessage
  | ImageMessage
  | AudioMessage
  | VideoMessage
  | DocumentMessage
  | StickerMessage;

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
    default: {
      const exhaustive: never = message;
      return exhaustive;
    }
  }
}
