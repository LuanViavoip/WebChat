import type { ChatMessage, MessageAuthor, MessageStatus } from '../domain/message';

export type TransportStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

export type ChatEvent =
  | { type: 'message'; message: ChatMessage }
  | { type: 'status'; messageId: string; status: MessageStatus }
  | { type: 'typing'; conversationId: string; actor: MessageAuthor; isTyping: boolean }
  | { type: 'connection'; status: TransportStatus };

export type ConnectSession = {
  conversationId: string;
  patientName: string;
};

export type ChatEventHandler = (event: ChatEvent) => void;

export interface ChatTransport {
  connect(session: ConnectSession): Promise<void>;
  disconnect(): void;
  send(text: string): Promise<void>;
  subscribe(handler: ChatEventHandler): () => void;
  getStatus(): TransportStatus;
}
