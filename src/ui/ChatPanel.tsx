import { useEffect, useRef, useState } from 'react';
import type { ChatMessage } from '../domain/message';
import { isTextMessage } from '../domain/message';
import type { ChatTransport } from '../transport/ChatTransport';
import { ChatHeader } from './ChatHeader';
import { historyConversationId, historyPane, mergeHistoryState } from './chatHistory';
import { Composer } from './Composer';
import { conversationById, isLiveConversation, LIVE_CONVERSATION_ID } from './conversations';
import { liveActivity } from './liveActivity';
import { MessageList } from './MessageList';
import { Sidebar } from './Sidebar';
import { useChatSession } from './useChatSession';
import { useMediaQuery } from './useMediaQuery';

type MobilePane = 'list' | 'chat';
type PendingFocus = 'chat' | 'list';

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
  const [mobilePane, setMobilePane] = useState<MobilePane>('list');
  const [uncontrolledId, setUncontrolledId] = useState(LIVE_CONVERSATION_ID);
  const [draft, setDraft] = useState('');
  const controlled = selectedConversationIdProp !== undefined;
  const selectedConversationId = selectedConversationIdProp ?? uncontrolledId;
  const live = isLiveConversation(selectedConversationId);
  const conversation = conversationById(selectedConversationId);
  const messages = live ? state.messages : conversation.transcript;
  const typing = live ? state.typing : { isTyping: false, actorName: '' };
  const disabled = state.connection !== 'connected' || state.ended;
  const preview = lastPreview(state.messages);
  const showBack = !compact && isMobile && mobilePane === 'chat';
  const activity = liveActivity(state);
  const pendingFocus = useRef<PendingFocus | null>(null);
  const isMobileRef = useRef(isMobile);
  const onSelectRef = useRef(onSelectConversation);
  const controlledRef = useRef(controlled);
  const historyReady = useRef(false);
  isMobileRef.current = isMobile;
  onSelectRef.current = onSelectConversation;
  controlledRef.current = controlled;

  useEffect(() => {
    if (compact) {
      return;
    }
    if (!historyReady.current) {
      historyReady.current = true;
      writeHistory(mobilePane, selectedConversationId, 'replace');
    }
    function onPop(event: PopStateEvent) {
      const pane = historyPane(event.state);
      const conversationId = historyConversationId(event.state);
      if (conversationId) {
        assignConversation(conversationId);
      }
      setMobilePane(pane);
      if (isMobileRef.current) {
        pendingFocus.current = pane === 'chat' ? 'chat' : 'list';
      }
    }
    window.addEventListener('popstate', onPop);
    return () => {
      window.removeEventListener('popstate', onPop);
    };
  }, [compact, mobilePane, selectedConversationId]);

  useEffect(() => {
    const target = pendingFocus.current;
    if (!target) {
      return;
    }
    pendingFocus.current = null;
    if (target === 'chat') {
      document.querySelector<HTMLElement>('.chat-header')?.focus();
      return;
    }
    document.querySelector<HTMLElement>(`[data-conversation-id="${CSS.escape(selectedConversationId)}"]`)?.focus();
  }, [mobilePane, selectedConversationId]);

  function assignConversation(id: string) {
    if (!controlledRef.current) {
      setUncontrolledId(id);
    }
    onSelectRef.current?.(id);
  }

  function selectConversation(id: string) {
    assignConversation(id);
    const nextPane: MobilePane = !compact && isMobile ? 'chat' : mobilePane;
    setMobilePane(nextPane);
    if (!compact) {
      const currentPane = historyPane(window.history.state);
      const currentId = historyConversationId(window.history.state);
      if (currentPane !== nextPane || currentId !== id) {
        writeHistory(nextPane, id, 'push');
      }
    }
    if (!compact && isMobile) {
      pendingFocus.current = 'chat';
    }
  }

  function backToList() {
    if (!compact && isMobile && historyPane(window.history.state) === 'chat') {
      window.history.back();
      return;
    }
    setMobilePane('list');
    if (!compact && isMobile) {
      pendingFocus.current = 'list';
    }
  }

  return (
    <section
      className={`wa-shell${compact ? ' wa-compact' : ''}`}
      data-mobile-pane={compact ? 'chat' : mobilePane}
      aria-label="Conversa com o ICS"
    >
      {compact ? null : (
        <Sidebar
          preview={preview}
          selectedConversationId={selectedConversationId}
          liveActivity={activity}
          onSelect={selectConversation}
        />
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
        {conversation.demo ? (
          <div className="session-banner session-banner-demo" role="note">
            <p>Conversa fictícia para demonstração. Não é o seu histórico clínico.</p>
          </div>
        ) : null}
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
          <Composer value={draft} onChange={setDraft} onSend={send} disabled={disabled} />
        ) : (
          <div className="session-banner">
            <p>Atendimento encerrado · somente leitura</p>
          </div>
        )}
      </div>
    </section>
  );
}

function writeHistory(pane: MobilePane, conversationId: string, mode: 'push' | 'replace') {
  const next = mergeHistoryState(window.history.state, { smPane: pane, conversationId });
  if (mode === 'push') {
    window.history.pushState(next, '');
    return;
  }
  window.history.replaceState(next, '');
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
