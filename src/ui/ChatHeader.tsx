import type { TransportStatus } from '../transport/ChatTransport';
import type { TypingState } from '../chat/ChatSession';

export function ChatHeader({
  connection,
  typing,
  onClose,
}: {
  connection: TransportStatus;
  typing: TypingState;
  onClose?: () => void;
}) {
  const online = connection === 'connected';
  const subtitle = typing.isTyping
    ? 'digitando…'
    : online
      ? 'online'
      : connection === 'connecting'
        ? 'conectando…'
        : 'offline';

  return (
    <header className="chat-header">
      <div className="avatar" aria-hidden="true">
        ICS
      </div>
      <div className="header-identity">
        <h1 className="header-title">ICS Pré-atendimento</h1>
        <p className="header-status" aria-live="polite">
          <span className={`status-dot ${online ? 'online' : 'offline'}`} />
          {subtitle}
        </p>
      </div>
      {onClose ? (
        <button type="button" className="header-close" aria-label="Fechar chat" onClick={onClose}>
          Fechar
        </button>
      ) : null}
    </header>
  );
}
