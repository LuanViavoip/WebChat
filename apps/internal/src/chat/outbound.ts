import { acceptsCaption, clampCaption, type ValidAttachment } from '@viavoip/internal-domain';
import type { ChatMessage, MessageStatus } from '@viavoip/internal-domain';
import type { ConversationId } from '@viavoip/internal-domain';
import type { UserId } from '@viavoip/internal-domain';
import type { TenantId } from '@viavoip/internal-domain';
import type { OutboundPayload } from '../transport/ChatTransport';

/** Quem e onde: tudo que a mensagem precisa além do conteúdo. */
export type MessageOrigin = {
  /** No cliente, o próprio `clientId`; no servidor, o id definitivo. */
  id: string;
  clientId: string;
  tenantId: TenantId;
  conversationId: ConversationId;
  authorId: UserId;
  authorName: string;
};

export function messageFromPayload(
  origin: MessageOrigin,
  payload: OutboundPayload,
  timestamp: string,
  status: MessageStatus,
): ChatMessage {
  const base = {
    id: origin.id,
    tenantId: origin.tenantId,
    conversationId: origin.conversationId,
    clientId: origin.clientId,
    authorId: origin.authorId,
    author: { id: origin.authorId, name: origin.authorName },
    timestamp,
    status,
  };
  switch (payload.type) {
    case 'text':
      return { ...base, type: 'text', text: payload.text };
    case 'image': {
      const message: ChatMessage = { ...base, type: 'image', mimeType: payload.mimeType, url: payload.url };
      if (payload.caption) {
        return { ...message, caption: payload.caption };
      }
      return message;
    }
    case 'audio': {
      const message: ChatMessage = { ...base, type: 'audio', mimeType: payload.mimeType, url: payload.url };
      if (payload.durationMs !== undefined) {
        return { ...message, durationMs: payload.durationMs };
      }
      return message;
    }
    case 'video': {
      const message: ChatMessage = { ...base, type: 'video', mimeType: payload.mimeType, url: payload.url };
      if (payload.caption) {
        return { ...message, caption: payload.caption };
      }
      return message;
    }
    case 'document': {
      const message: ChatMessage = {
        ...base,
        type: 'document',
        fileName: payload.fileName,
        mimeType: payload.mimeType,
        url: payload.url,
      };
      if (payload.sizeBytes !== undefined) {
        return { ...message, sizeBytes: payload.sizeBytes };
      }
      return message;
    }
    case 'sticker':
      return { ...base, type: 'sticker', mimeType: payload.mimeType, url: payload.url };
    default: {
      const exhaustive: never = payload;
      return exhaustive;
    }
  }
}

export function payloadFromMessage(message: ChatMessage): OutboundPayload {
  switch (message.type) {
    case 'text':
      return { type: 'text', text: message.text };
    case 'image': {
      const payload: OutboundPayload = { type: 'image', mimeType: message.mimeType, url: message.url };
      if (message.caption) {
        return { ...payload, caption: message.caption };
      }
      return payload;
    }
    case 'audio': {
      const payload: OutboundPayload = { type: 'audio', mimeType: message.mimeType, url: message.url };
      if (message.durationMs !== undefined) {
        return { ...payload, durationMs: message.durationMs };
      }
      return payload;
    }
    case 'video': {
      const payload: OutboundPayload = { type: 'video', mimeType: message.mimeType, url: message.url };
      if (message.caption) {
        return { ...payload, caption: message.caption };
      }
      return payload;
    }
    case 'document': {
      const payload: OutboundPayload = {
        type: 'document',
        fileName: message.fileName,
        mimeType: message.mimeType,
        url: message.url,
      };
      if (message.sizeBytes !== undefined) {
        return { ...payload, sizeBytes: message.sizeBytes };
      }
      return payload;
    }
    case 'sticker':
      return { type: 'sticker', mimeType: message.mimeType, url: message.url };
    default: {
      const exhaustive: never = message;
      return exhaustive;
    }
  }
}

export function payloadForAttachment(
  attachment: ValidAttachment,
  url: string,
  caption?: string,
): OutboundPayload {
  const trimmed = caption ? clampCaption(caption.trim()) : undefined;
  switch (attachment.kind) {
    case 'image':
      return trimmed && acceptsCaption(attachment.kind)
        ? { type: 'image', mimeType: attachment.mimeType, url, caption: trimmed }
        : { type: 'image', mimeType: attachment.mimeType, url };
    case 'video':
      return trimmed && acceptsCaption(attachment.kind)
        ? { type: 'video', mimeType: attachment.mimeType, url, caption: trimmed }
        : { type: 'video', mimeType: attachment.mimeType, url };
    case 'audio':
      return { type: 'audio', mimeType: attachment.mimeType, url };
    case 'document':
      return {
        type: 'document',
        fileName: attachment.fileName,
        mimeType: attachment.mimeType,
        url,
        sizeBytes: attachment.sizeBytes,
      };
    default: {
      const exhaustive: never = attachment.kind;
      return exhaustive;
    }
  }
}

export function normalizePayload(payload: OutboundPayload): OutboundPayload | undefined {
  if (payload.type !== 'text') {
    return payload;
  }
  const text = payload.text.trim();
  if (!text) {
    return undefined;
  }
  return { type: 'text', text };
}
