import type { ChatMessage, MessageAuthor, MessageStatus } from '../domain/message';
import type { OutboundPayload } from '../transport/ChatTransport';

const CLIENT_AUTHOR: MessageAuthor = { id: 'client', name: 'Você' };

export function messageFromPayload(
  clientId: string,
  conversationId: string,
  payload: OutboundPayload,
  timestamp: string,
  status: MessageStatus,
): ChatMessage {
  const base = {
    id: clientId,
    conversationId,
    clientId,
    direction: 'client' as const,
    author: CLIENT_AUTHOR,
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
    case 'document':
      return {
        ...base,
        type: 'document',
        fileName: payload.fileName,
        mimeType: payload.mimeType,
        url: payload.url,
      };
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
    case 'document':
      return {
        type: 'document',
        fileName: message.fileName,
        mimeType: message.mimeType,
        url: message.url,
      };
    case 'sticker':
      return { type: 'sticker', mimeType: message.mimeType, url: message.url };
    default: {
      const exhaustive: never = message;
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
