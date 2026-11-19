import {
  acceptsCaption,
  asClientId,
  asMessageId,
  asPollOptionId,
  clampCaption,
  type ChatMessage,
  type ConversationId,
  type IsoInstant,
  type MessageStatus,
  type TenantId,
  type UserId,
  type ValidAttachment,
} from '@viavoip/internal-domain';
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
  timestamp: IsoInstant,
  status: MessageStatus,
): ChatMessage {
  const base = {
    id: asMessageId(origin.id),
    tenantId: origin.tenantId,
    conversationId: origin.conversationId,
    clientId: asClientId(origin.clientId),
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
      return {
        ...base,
        type: 'audio',
        mimeType: payload.mimeType,
        url: payload.url,
        ...(payload.durationMs !== undefined ? { durationMs: payload.durationMs } : {}),
        ...(payload.waveform !== undefined ? { waveform: payload.waveform } : {}),
      };
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
    case 'poll': {
      const [first, second, ...rest] = payload.options.map((text, index) => ({
        id: asPollOptionId(`opt-${String(index + 1)}`),
        text,
      }));
      if (!first || !second) {
        throw new Error('Enquete exige ao menos duas opções.');
      }
      return {
        ...base,
        type: 'poll',
        question: payload.question,
        options: [first, second, ...rest],
        multiple: payload.multiple,
        closedAt: null,
      };
    }
    default: {
      const exhaustive: never = payload;
      return exhaustive;
    }
  }
}

export function payloadFromMessage(message: ChatMessage): OutboundPayload {
  switch (message.type) {
    case 'system':
      throw new Error('Mensagem de sistema não pode ser enviada.');
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
      return {
        type: 'audio',
        mimeType: message.mimeType,
        url: message.url,
        ...(message.durationMs !== undefined ? { durationMs: message.durationMs } : {}),
        ...(message.waveform !== undefined ? { waveform: message.waveform } : {}),
      };
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
    case 'poll':
      return {
        type: 'poll',
        question: message.question,
        options: message.options.map((option) => option.text),
        multiple: message.multiple,
      };
    case 'announcement':
    case 'deleted':
      throw new Error('Este tipo de mensagem não pode ser reenviado.');
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
