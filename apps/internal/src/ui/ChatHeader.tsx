import { ArrowLeft, MoreVertical, Search } from 'lucide-react';
import type { TransportStatus } from '../transport/ChatTransport';
import type { TypingState } from '../chat/ChatSession';
import { conversationInitials } from './conversations';

export function ChatHeader({
  title,
  roleText,
  connection,
  typing,
  headingLevel = 'h2',
  onBack,
  unseenLive = false,
}: {
  title: string;
  /** Role do outro lado (em português); grupos não têm. */
  roleText?: string;
  connection: TransportStatus;
  typing: TypingState;
  headingLevel?: 'h1' | 'h2';
  onBack?: () => void;
  unseenLive?: boolean;
}) {
  const online = connection === 'connected';
  const subtitle = headerSubtitle(connection, typing);

  return (
    <header className="chat-header" tabIndex={-1}>
      {onBack ? (
        <button
          type="button"
          className={`icon-button header-back${unseenLive ? ' has-unseen' : ''}`}
          aria-label={unseenLive ? 'Voltar, conversas não lidas' : 'Voltar'}
          onClick={onBack}
        >
          <ArrowLeft size={20} strokeWidth={1.7} aria-hidden="true" />
          {unseenLive ? <span className="unseen-dot" aria-hidden="true" /> : null}
        </button>
      ) : null}
      <div className="avatar avatar-contact" aria-hidden="true">
        {conversationInitials(title)}
      </div>
      <div className="header-identity">
        <HeaderTitle level={headingLevel}>{title}</HeaderTitle>
        <p className="header-status">
          <span className={`status-dot ${online ? 'online' : 'offline'}`} />
          {roleText ? (
            <>
              <span className="header-role">{roleText}</span>
              <span aria-hidden="true">·</span>
            </>
          ) : null}
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
  if (typing.activity === 'typing') return 'digitando…';
  if (typing.activity === 'recording-audio') return 'gravando áudio…';
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
