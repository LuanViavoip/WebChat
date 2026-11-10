import type { ChatMessage } from '../domain/message';
import { formatTime } from '../chat/dates';
import { isTextMessage } from '../domain/message';
import { StatusTicks } from './StatusTicks';

export function MessageBubble({
  message,
  onRetry,
}: {
  message: ChatMessage;
  onRetry?: (messageId: string) => void;
}) {
  const outgoing = message.direction === 'client';
  const body = renderBody(message);
  return (
    <article
      className={`bubble bubble-${message.direction} ${outgoing ? 'outgoing' : 'incoming'}`}
      aria-label={`${message.author.name}: ${preview(message)}`}
    >
      {message.direction !== 'client' && message.direction !== 'system' ? (
        <p className="bubble-author">{message.author.name}</p>
      ) : null}
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
