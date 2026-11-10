import type { ChatMessage } from '../domain/message';
import { isTextMessage } from '../domain/message';
import type { ChatTransport } from '../transport/ChatTransport';
import { ChatHeader } from './ChatHeader';
import { Composer } from './Composer';
import { MessageList } from './MessageList';
import { Sidebar } from './Sidebar';
import { useChatSession } from './useChatSession';

export function ChatPanel({
  transport,
  patientName,
  onClose,
  compact = false,
}: {
  transport: ChatTransport;
  patientName: string;
  onClose?: () => void;
  compact?: boolean;
}) {
  const { state, send, sendMenuOption, retry, reconnect, restart } = useChatSession(transport, patientName);
  const disabled = state.connection !== 'connected' || state.ended;
  const preview = lastPreview(state.messages);

  return (
    <section className={`wa-shell${compact ? ' wa-compact' : ''}`} aria-label="Conversa com o ICS">
      {compact ? null : <Sidebar preview={preview} />}
      <div className="wa-chat">
        <ChatHeader
          connection={state.connection}
          typing={state.typing}
          {...(onClose ? { onClose } : {})}
        />
        <MessageList
          messages={state.messages}
          typing={state.typing}
          menu={state.menu}
          menuDisabled={disabled}
          onMenuSelect={sendMenuOption}
          onRetry={retry}
        />
        {state.error ? (
          <div className="session-banner session-banner-error" role="alert">
            <p>{state.error}</p>
            <button type="button" onClick={reconnect}>
              Reconectar
            </button>
          </div>
        ) : null}
        {state.ended ? (
          <div className="session-banner">
            <p>
              <strong>Atendimento encerrado</strong>. Toque para iniciar um novo.
            </p>
            <button type="button" onClick={restart}>
              Iniciar novo atendimento
            </button>
          </div>
        ) : null}
        <Composer onSend={send} disabled={disabled} />
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
