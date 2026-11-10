import { useEffect, useMemo, useState } from 'react';
import { ChatSession, type ChatSessionState } from '../chat/ChatSession';
import type { MenuOption } from '../domain/message';
import type { ChatTransport } from '../transport/ChatTransport';

const EMPTY: ChatSessionState = {
  messages: [],
  connection: 'disconnected',
  typing: { isTyping: false, actorName: '' },
  menu: [],
  ended: false,
  error: null,
};

export function useChatSession(transport: ChatTransport, patientName: string) {
  const session = useMemo(() => new ChatSession(transport), [transport]);
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
      void session.send(text);
    },
    sendMenuOption: (option: MenuOption) => {
      void session.sendMenuOption(option);
    },
    retry: (messageId: string) => {
      void session.retry(messageId);
    },
    restart: () => {
      void session.start(patientName);
    },
  };
}
