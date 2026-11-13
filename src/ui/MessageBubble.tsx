import type { UploadView } from '../chat/uploads';
import { formatTime } from '../chat/dates';
import type { ChatMessage } from '../domain/message';
import { isTextMessage, previewOf } from '../domain/message';
import { MediaBody, type OpenImage } from './attachments/MediaBody';
import { StatusTicks } from './StatusTicks';

export function MessageBubble({
  message,
  onRetry,
  showTail,
  upload,
  onOpenImage,
  onCancelUpload,
}: {
  message: ChatMessage;
  onRetry?: (messageId: string) => void;
  showTail: boolean;
  upload?: UploadView;
  onOpenImage?: (image: OpenImage, opener: HTMLElement) => void;
  onCancelUpload?: (id: string) => void;
}) {
  const outgoing = message.direction === 'client';
  const body = renderBody(message, { upload, onOpenImage, onCancelUpload, onRetry });
  const showGenericRetry = outgoing && message.status === 'error' && onRetry && !upload;
  return (
    <article
      className={`bubble bubble-${message.direction} ${outgoing ? 'outgoing' : 'incoming'}${showTail ? ' has-tail' : ''}`}
      aria-label={`${message.author.name}: ${previewOf(message)}`}
    >
      <div className="bubble-body">{body}</div>
      <p className="bubble-meta">
        <time dateTime={message.timestamp}>{formatTime(message.timestamp)}</time>
        {outgoing ? <StatusTicks status={message.status} /> : null}
        {showGenericRetry ? (
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

function renderBody(
  message: ChatMessage,
  extras: {
    upload?: UploadView;
    onOpenImage?: (image: OpenImage, opener: HTMLElement) => void;
    onCancelUpload?: (id: string) => void;
    onRetry?: (id: string) => void;
  },
) {
  if (isTextMessage(message)) {
    return <p className="bubble-text">{message.text}</p>;
  }
  return (
    <MediaBody
      message={message}
      {...(extras.upload ? { upload: extras.upload } : {})}
      {...(extras.onOpenImage ? { onOpenImage: extras.onOpenImage } : {})}
      {...(extras.onCancelUpload ? { onCancelUpload: extras.onCancelUpload } : {})}
      {...(extras.onRetry ? { onRetry: extras.onRetry } : {})}
    />
  );
}
