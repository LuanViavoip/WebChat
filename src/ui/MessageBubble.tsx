import type { ChatMessage, MenuOption } from '../domain/message';
import { formatTime } from '../chat/dates';
import { isTextMessage } from '../domain/message';
import { StatusTicks } from './StatusTicks';

export function MessageBubble({
  message,
  onRetry,
  showTail,
  menu,
  menuDisabled,
  onMenuSelect,
}: {
  message: ChatMessage;
  onRetry?: (messageId: string) => void;
  showTail: boolean;
  menu?: MenuOption[];
  menuDisabled?: boolean;
  onMenuSelect?: (option: MenuOption) => void;
}) {
  const outgoing = message.direction === 'client';
  const body = renderBody(message);
  const hasMenu = Boolean(menu && menu.length > 0 && onMenuSelect);
  return (
    <article
      className={`bubble bubble-${message.direction} ${outgoing ? 'outgoing' : 'incoming'}${showTail ? ' has-tail' : ''}`}
      aria-label={`${message.author.name}: ${preview(message)}`}
    >
      <div className="bubble-body">{body}</div>
      <p className="bubble-meta">
        <time dateTime={message.timestamp}>{formatTime(message.timestamp)}</time>
        {outgoing ? <StatusTicks status={message.status} /> : null}
        {outgoing && message.status === 'error' && onRetry ? (
          <button
            type="button"
            className="retry-button"
            aria-label="Reenviar mensagem"
            onClick={() => {
              onRetry(message.id);
            }}
          >
            Reenviar
          </button>
        ) : null}
      </p>
      {hasMenu && menu && onMenuSelect ? (
        <div className="bubble-actions" aria-label="Opções do atendimento">
          {menu.map((option) => (
            <button
              key={option.key}
              type="button"
              className="bubble-action"
              disabled={menuDisabled}
              onClick={() => {
                onMenuSelect(option);
              }}
            >
              {option.key} — {option.label}
            </button>
          ))}
        </div>
      ) : null}
    </article>
  );
}

function renderBody(message: ChatMessage) {
  switch (message.type) {
    case 'text':
      return <p className="bubble-text">{message.text}</p>;
    case 'image':
    case 'audio':
    case 'video':
    case 'document':
    case 'sticker':
      return <p className="bubble-text">Mensagem de {message.type} ainda não suportada nesta etapa.</p>;
    default: {
      const exhaustive: never = message;
      return exhaustive;
    }
  }
}

function preview(message: ChatMessage): string {
  if (isTextMessage(message)) {
    return message.text;
  }
  return message.type;
}
