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
  const subtitle = headerSubtitle(connection, typing);

  return (
    <header className="chat-header">
      <div className="avatar" aria-hidden="true">
        ICS
      </div>
      <div className="header-identity">
        <h1 className="header-title">ICS Pré-atendimento</h1>
        <p className="header-status">
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

function headerSubtitle(connection: TransportStatus, typing: TypingState): string {
  if (typing.isTyping) {
    return 'digitando…';
  }
  switch (connection) {
    case 'connected':
      return 'online';
    case 'connecting':
      return 'conectando…';
    case 'error':
      return 'falha na conexão';
    case 'disconnected':
      return 'offline';
    default: {
      const exhaustive: never = connection;
      return exhaustive;
    }
  }
}
