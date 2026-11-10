import type { ChatTransport } from '../transport/ChatTransport';
import { ChatHeader } from './ChatHeader';
import { Composer } from './Composer';
import { MenuBar } from './MenuBar';
import { MessageList } from './MessageList';
import { useChatSession } from './useChatSession';

export function ChatPanel({
  transport,
  patientName,
  onClose,
}: {
  transport: ChatTransport;
  patientName: string;
  onClose?: () => void;
}) {
  const { state, send, sendMenuOption, retry, reconnect, restart } = useChatSession(transport, patientName);
  const disabled = state.connection !== 'connected' || state.ended;
  const announcement = state.typing.isTyping ? `${state.typing.actorName} está digitando…` : '';

  return (
    <section className="chat-panel" aria-label="Conversa com o ICS">
      <div className="sr-only" aria-live="polite" aria-atomic="true">
        {announcement}
      </div>
      <ChatHeader
        connection={state.connection}
        typing={state.typing}
        {...(onClose ? { onClose } : {})}
      />
      <MessageList messages={state.messages} typing={state.typing} onRetry={retry} />
      {state.error ? (
        <div className="session-banner session-banner-error" role="alert">
          <p>{state.error}</p>
          <button type="button" onClick={reconnect}>
            Reconectar
          </button>
        </div>
      ) : null}
      {state.ended ? (
        <div className="session-banner" role="status">
          <p>Atendimento encerrado</p>
          <button type="button" onClick={restart}>
            Iniciar novo atendimento
          </button>
        </div>
      ) : null}
      <MenuBar options={state.menu} onSelect={sendMenuOption} disabled={disabled} />
      <Composer onSend={send} disabled={disabled} />
    </section>
  );
}
