import { useEffect, useMemo, useState } from 'react';
import { ChatSession, type ChatSessionState, type TypingState } from '../chat/ChatSession';
import type { UploadView } from '../chat/uploads';
import type { ConversationId } from '../domain/conversation';
import type { ChatMessage } from '../domain/message';
import type { ChatTransport, ConnectRequest, TransportStatus } from '../transport/ChatTransport';
import type { ObjectUrlFactory } from '../transport/objectUrls';

const EMPTY: ChatSessionState = {
  connection: 'disconnected',
  error: null,
  errorConversationId: null,
  tenant: null,
  me: null,
  directory: null,
  grantLog: null,
  sessionEnded: null,
  conversations: {},
  summaries: [],
  activeConversationId: null,
};

const NO_MESSAGES: ChatMessage[] = [];
const IDLE: TypingState = { isTyping: false, actorName: '' };
const NO_UPLOADS: Readonly<Record<string, UploadView>> = {};

/** A visão de UMA conversa: é o que o painel de chat consome. */
export type ThreadView = {
  messages: ChatMessage[];
  connection: TransportStatus;
  typing: TypingState;
  /** Erro da sessão (conexão) ou da própria conversa; o erro de outra conversa não aparece aqui. */
  error: string | null;
  uploads: Readonly<Record<string, UploadView>>;
};

export function threadView(full: ChatSessionState, conversationId: ConversationId | null): ThreadView {
  const thread = conversationId ? full.conversations[conversationId] : undefined;
  const ownsError = full.errorConversationId === null || full.errorConversationId === conversationId;
  return {
    messages: thread?.messages ?? NO_MESSAGES,
    connection: full.connection,
    typing: thread?.typing ?? IDLE,
    error: ownsError ? full.error : null,
    uploads: thread?.uploads ?? NO_UPLOADS,
  };
}

/**
 * Uma ChatSession por usuário conectado. Ao trocar de usuário (ou desmontar) a sessão para:
 * aborta uploads, revoga URLs e desconecta; a nova recomeça do Bootstrap.
 */
export function useChatSession(
  transport: ChatTransport,
  identity: ConnectRequest,
  options?: { objectUrls?: ObjectUrlFactory },
): { session: ChatSession; state: ChatSessionState } {
  const objectUrls = options?.objectUrls;
  const { tenantId, userId } = identity;
  const session = useMemo(
    () => new ChatSession(transport, { objectUrls, identity: { tenantId, userId } }),
    [transport, objectUrls, tenantId, userId],
  );
  const [state, setState] = useState<ChatSessionState>(EMPTY);

  useEffect(() => {
    const unsubscribe = session.subscribe(setState);
    void session.start();
    return () => {
      unsubscribe();
      session.stop();
    };
  }, [session]);

  return { session, state };
}
