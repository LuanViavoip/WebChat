import { useEffect, useMemo, useState } from 'react';
import { ChatSession, type ChatSessionState } from '../chat/ChatSession';
import type { ValidAttachment } from '../domain/attachment';
import type { ChatTransport } from '../transport/ChatTransport';
import type { ObjectUrlFactory } from '../transport/objectUrls';
import { LIVE_CONVERSATION_ID } from './conversations';

const EMPTY: ChatSessionState = {
  messages: [],
  connection: 'disconnected',
  typing: { isTyping: false, actorName: '' },
  error: null,
  uploads: {},
};

export function useChatSession(
  transport: ChatTransport,
  options?: { objectUrls?: ObjectUrlFactory },
) {
  const objectUrls = options?.objectUrls;
  const session = useMemo(() => new ChatSession(transport, { objectUrls }), [transport, objectUrls]);
  const [state, setState] = useState<ChatSessionState>(EMPTY);

  useEffect(() => {
    const unsubscribe = session.subscribe(setState);
    void session.start(LIVE_CONVERSATION_ID);
    return () => {
      unsubscribe();
      session.stop();
    };
  }, [session]);

  return {
    state,
    send: (text: string) => {
      void session.send({ type: 'text', text });
    },
    retry: (messageId: string) => {
      void session.retry(messageId);
    },
    reconnect: () => {
      void session.reconnect();
    },
    sendAttachment: (attachment: ValidAttachment, caption?: string) => {
      void session.sendAttachment(attachment, caption);
    },
    cancelUpload: (messageId: string) => {
      session.cancelUpload(messageId);
    },
  };
}
