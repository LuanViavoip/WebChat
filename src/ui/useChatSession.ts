import { useEffect, useMemo, useState } from 'react';
import { ChatSession, type ChatSessionState, type TypingState } from '../chat/ChatSession';
import type { ValidAttachment } from '../domain/attachment';
import type { ConversationId } from '../domain/conversation';
import type { ChatMessage } from '../domain/message';
import type { ChatTransport, TransportStatus } from '../transport/ChatTransport';
import type { ObjectUrlFactory } from '../transport/objectUrls';
import type { UploadView } from '../chat/uploads';

const EMPTY: ChatSessionState = {
  connection: 'disconnected',
  error: null,
  tenant: null,
  me: null,
  directory: null,
  conversations: {},
  summaries: [],
  activeConversationId: null,
};

const NO_MESSAGES: ChatMessage[] = [];
const IDLE: TypingState = { isTyping: false, actorName: '' };
const NO_UPLOADS: Readonly<Record<string, UploadView>> = {};

/** A visão de uma conversa só: é o que a UI de conversa única (até o Bloco 4) consome. */
export type ThreadView = {
  messages: ChatMessage[];
  connection: TransportStatus;
  typing: TypingState;
  error: string | null;
  uploads: Readonly<Record<string, UploadView>>;
};

export function useChatSession(
  transport: ChatTransport,
  conversationId: ConversationId,
  options?: { objectUrls?: ObjectUrlFactory },
) {
  const objectUrls = options?.objectUrls;
  const session = useMemo(() => new ChatSession(transport, { objectUrls }), [transport, objectUrls]);
  const [full, setFull] = useState<ChatSessionState>(EMPTY);

  useEffect(() => {
    const unsubscribe = session.subscribe(setFull);
    void session.start();
    return () => {
      unsubscribe();
      session.stop();
    };
  }, [session]);

  useEffect(() => {
    session.selectConversation(conversationId);
  }, [session, conversationId]);

  const thread = full.conversations[conversationId];
  const state: ThreadView = {
    messages: thread?.messages ?? NO_MESSAGES,
    connection: full.connection,
    typing: thread?.typing ?? IDLE,
    error: full.error,
    uploads: thread?.uploads ?? NO_UPLOADS,
  };

  return {
    state,
    session: full,
    send: (text: string) => {
      void session.send(conversationId, text);
    },
    retry: (messageId: string) => {
      void session.retry(conversationId, messageId);
    },
    reconnect: () => {
      void session.reconnect();
    },
    sendAttachment: (attachment: ValidAttachment, caption?: string) => {
      void session.sendAttachment(conversationId, attachment, caption);
    },
    cancelUpload: (messageId: string) => {
      session.cancelUpload(conversationId, messageId);
    },
  };
}
