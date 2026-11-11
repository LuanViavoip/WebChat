import { ArrowLeft, MoreVertical, Search, X } from 'lucide-react';
import type { TransportStatus } from '../transport/ChatTransport';
import type { TypingState } from '../chat/ChatSession';

export function ChatHeader({
  title,
  connection,
  typing,
  readOnly = false,
  headingLevel = 'h1',
  onClose,
  onBack,
}: {
  title: string;
  connection: TransportStatus;
  typing: TypingState;
  readOnly?: boolean;
  headingLevel?: 'h1' | 'h2';
  onClose?: () => void;
  onBack?: () => void;
}) {
  const online = connection === 'connected';
  const subtitle = readOnly ? 'Atendimento encerrado' : headerSubtitle(connection, typing);

  return (
    <header className="chat-header" tabIndex={-1}>
      {onBack ? (
        <button type="button" className="icon-button header-back" aria-label="Voltar" onClick={onBack}>
          <ArrowLeft size={20} strokeWidth={1.7} aria-hidden="true" />
        </button>
      ) : null}
      <div className="avatar avatar-ics" aria-hidden="true">
        ICS
      </div>
      <div className="header-identity">
        <HeaderTitle level={headingLevel}>{title}</HeaderTitle>
        <p className="header-status">
          <span className={`status-dot ${!readOnly && online ? 'online' : 'offline'}`} />
          {subtitle}
        </p>
      </div>
      <div className="header-actions">
        <button type="button" className="icon-button" aria-label="Buscar na conversa (em breve)" title="em breve" disabled>
          <Search size={20} strokeWidth={1.7} aria-hidden="true" />
        </button>
        <button type="button" className="icon-button" aria-label="Menu da conversa (em breve)" title="em breve" disabled>
          <MoreVertical size={20} strokeWidth={1.7} aria-hidden="true" />
        </button>
        {onClose ? (
          <button type="button" className="icon-button" aria-label="Fechar chat" onClick={onClose}>
            <X size={20} strokeWidth={1.7} aria-hidden="true" />
          </button>
        ) : null}
      </div>
    </header>
  );
}

function HeaderTitle({ level, children }: { level: 'h1' | 'h2'; children: string }) {
  switch (level) {
    case 'h1':
      return <h1 className="header-title">{children}</h1>;
    case 'h2':
      return <h2 className="header-title">{children}</h2>;
    default: {
      const exhaustive: never = level;
      return exhaustive;
    }
  }
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
