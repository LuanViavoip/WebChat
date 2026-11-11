import { useEffect, useState } from 'react';
import type { ChatMessage } from '../domain/message';
import { isTextMessage } from '../domain/message';
import type { ChatTransport } from '../transport/ChatTransport';
import { ChatHeader } from './ChatHeader';
import { Composer } from './Composer';
import { conversationById, isLiveConversation, LIVE_CONVERSATION_ID } from './conversations';
import { MessageList } from './MessageList';
import { Sidebar } from './Sidebar';
import { useChatSession } from './useChatSession';
import { useMediaQuery } from './useMediaQuery';

type ChatHistoryState = { smPane?: 'list' | 'chat' };

export function ChatPanel({
  transport,
  patientName,
  onClose,
  compact = false,
  selectedConversationId: selectedConversationIdProp,
  onSelectConversation,
}: {
  transport: ChatTransport;
  patientName: string;
  onClose?: () => void;
  compact?: boolean;
  selectedConversationId?: string;
  onSelectConversation?: (id: string) => void;
}) {
  const { state, send, sendMenuOption, retry, reconnect, restart } = useChatSession(transport, patientName);
  const isMobile = useMediaQuery('(max-width: 900px)');
  const [mobilePane, setMobilePane] = useState<'list' | 'chat'>('list');
  const [uncontrolledId, setUncontrolledId] = useState(LIVE_CONVERSATION_ID);
  const controlled = selectedConversationIdProp !== undefined;
  const selectedConversationId = selectedConversationIdProp ?? uncontrolledId;
  const live = isLiveConversation(selectedConversationId);
  const conversation = conversationById(selectedConversationId);
  const messages = live ? state.messages : conversation.transcript;
  const typing = live ? state.typing : { isTyping: false, actorName: '' };
  const disabled = state.connection !== 'connected' || state.ended;
  const preview = lastPreview(state.messages);
  const showBack = !compact && isMobile && mobilePane === 'chat';

  useEffect(() => {
    if (compact) {
      return;
    }
    function onPop(event: PopStateEvent) {
      const historyState = event.state as ChatHistoryState | null;
      setMobilePane(historyState?.smPane === 'chat' ? 'chat' : 'list');
    }
    window.addEventListener('popstate', onPop);
    return () => {
      window.removeEventListener('popstate', onPop);
    };
  }, [compact]);

  function selectConversation(id: string) {
    if (!controlled) {
      setUncontrolledId(id);
    }
    onSelectConversation?.(id);
    setMobilePane('chat');
    if (!compact && isMobile) {
      const current = window.history.state as ChatHistoryState | null;
      if (current?.smPane !== 'chat') {
        window.history.pushState({ smPane: 'chat' }, '');
      }
    }
  }

  function backToList() {
    const current = window.history.state as ChatHistoryState | null;
    if (!compact && isMobile && current?.smPane === 'chat') {
      window.history.back();
      return;
    }
    setMobilePane('list');
  }

  return (
    <section
      className={`wa-shell${compact ? ' wa-compact' : ''}`}
      data-mobile-pane={compact ? 'chat' : mobilePane}
      aria-label="Conversa com o ICS"
    >
      {compact ? null : (
        <Sidebar preview={preview} selectedConversationId={selectedConversationId} onSelect={selectConversation} />
      )}
      <div className="wa-chat">
        <ChatHeader
          title={conversation.title}
          connection={state.connection}
          typing={typing}
          readOnly={!live}
          headingLevel={compact ? 'h1' : 'h2'}
          {...(onClose ? { onClose } : {})}
          {...(showBack ? { onBack: backToList } : {})}
        />
        <MessageList
          messages={messages}
          typing={typing}
          menu={live ? state.menu : []}
          menuDisabled={!live || disabled}
          onMenuSelect={sendMenuOption}
          onRetry={retry}
        />
        {live && state.error ? (
          <div className="session-banner session-banner-error" role="alert">
            <p>{state.error}</p>
            <button type="button" onClick={reconnect}>
              Reconectar
            </button>
          </div>
        ) : null}
        {live && state.ended ? (
          <div className="session-banner">
            <p>
              <strong>Atendimento encerrado</strong>. Toque para iniciar um novo.
            </p>
            <button type="button" onClick={restart}>
              Iniciar novo atendimento
            </button>
          </div>
        ) : null}
        {live ? (
          <Composer onSend={send} disabled={disabled} />
        ) : (
          <div className="session-banner">
            <p>Atendimento encerrado · somente leitura</p>
          </div>
        )}
      </div>
    </section>
  );
}

function lastPreview(messages: ChatMessage[]): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message && isTextMessage(message)) {
      const line = message.text.split('\n')[0]?.trim();
      if (line) {
        return line.length > 42 ? `${line.slice(0, 41)}…` : line;
      }
    }
  }
  return 'ICS Pré-atendimento';
}
