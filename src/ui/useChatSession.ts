import { useEffect, useMemo, useState } from 'react';
import { ChatSession, type ChatSessionState } from '../chat/ChatSession';
import type { ValidAttachment } from '../domain/attachment';
import type { MenuOption } from '../domain/message';
import type { ChatTransport } from '../transport/ChatTransport';
import type { ObjectUrlFactory } from '../transport/objectUrls';

const EMPTY: ChatSessionState = {
  messages: [],
  connection: 'disconnected',
  typing: { isTyping: false, actorName: '' },
  menu: [],
  ended: false,
  error: null,
  uploads: {},
};

export function useChatSession(
  transport: ChatTransport,
  patientName: string,
  options?: { objectUrls?: ObjectUrlFactory },
) {
  const objectUrls = options?.objectUrls;
  const session = useMemo(() => new ChatSession(transport, { objectUrls }), [transport, objectUrls]);
  const [state, setState] = useState<ChatSessionState>(EMPTY);

  useEffect(() => {
    const unsubscribe = session.subscribe(setState);
    void session.start(patientName);
    return () => {
      unsubscribe();
      session.stop();
    };
  }, [patientName, session]);

  return {
    state,
    send: (text: string) => {
      void session.send({ type: 'text', text });
    },
    sendMenuOption: (option: MenuOption) => {
      void session.sendMenuOption(option);
    },
    retry: (messageId: string) => {
      void session.retry(messageId);
    },
    reconnect: () => {
      void session.reconnect();
    },
    restart: () => {
      void session.start(patientName);
    },
    sendAttachment: (attachment: ValidAttachment, caption?: string) => {
      void session.sendAttachment(attachment, caption);
    },
    cancelUpload: (messageId: string) => {
      session.cancelUpload(messageId);
    },
  };
}
