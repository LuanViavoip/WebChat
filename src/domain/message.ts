export type MessageSender = 'client' | 'agent' | 'bot' | 'system';

export type MessageStatus = 'sending' | 'sent' | 'delivered' | 'read' | 'error';

export type MessageKind = 'text' | 'image' | 'audio' | 'video' | 'document' | 'sticker';

export type MessageAuthor = {
  id: string;
  name: string;
};

export type MenuOption = {
  key: string;
  label: string;
};

type MessageBase = {
  id: string;
  conversationId: string;
  direction: MessageSender;
  author: MessageAuthor;
  timestamp: string;
  status: MessageStatus;
};

export type TextMessage = MessageBase & {
  type: 'text';
  text: string;
  menu?: MenuOption[];
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
};

export type StickerMessage = MessageBase & {
  type: 'sticker';
  mimeType: string;
  url: string;
};

export type ChatMessage =
  | TextMessage
  | ImageMessage
  | AudioMessage
  | VideoMessage
  | DocumentMessage
  | StickerMessage;

export function isTextMessage(message: ChatMessage): message is TextMessage {
  return message.type === 'text';
}

export function textOf(message: ChatMessage): string {
  switch (message.type) {
    case 'text':
      return message.text;
    case 'image':
      return message.caption ?? '';
    case 'audio':
      return '';
    case 'video':
      return message.caption ?? '';
    case 'document':
      return message.fileName;
    case 'sticker':
      return '';
    default: {
      const exhaustive: never = message;
      return exhaustive;
    }
  }
}
