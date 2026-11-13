import type { ChatMessage, MessageAuthor, MessageStatus } from '../domain/message';

export type TransportStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

export type OutboundPayload =
  | { type: 'text'; text: string }
  | { type: 'image'; caption?: string; mimeType: string; url: string }
  | { type: 'audio'; mimeType: string; url: string; durationMs?: number }
  | { type: 'video'; caption?: string; mimeType: string; url: string }
  | { type: 'document'; fileName: string; mimeType: string; url: string; sizeBytes?: number }
  | { type: 'sticker'; mimeType: string; url: string };

export type SendRequest = {
  clientId: string;
  payload: OutboundPayload;
};

export type UploadProgress = { loaded: number; total: number };

export type UploadRequest = {
  clientId: string;
  file: Blob;
  fileName: string;
  mimeType: string;
  signal: AbortSignal;
  onProgress: (progress: UploadProgress) => void;
};

export type UploadedMedia = { url: string };

export type ChatEvent =
  | { type: 'message'; message: ChatMessage }
  | { type: 'status'; messageId: string; clientId?: string; status: MessageStatus }
  | { type: 'typing'; conversationId: string; actor: MessageAuthor; isTyping: boolean }
  | { type: 'connection'; status: TransportStatus }
  | { type: 'ended'; conversationId: string };

export type ConnectSession = {
  conversationId: string;
  patientName: string;
};

export type ChatEventHandler = (event: ChatEvent) => void;

export interface ChatTransport {
  connect(session: ConnectSession): Promise<void>;
  disconnect(): void;
  send(request: SendRequest): Promise<void>;
  upload(request: UploadRequest): Promise<UploadedMedia>;
  subscribe(handler: ChatEventHandler): () => void;
  getStatus(): TransportStatus;
}
