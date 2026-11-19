import type { UploadView } from '../chat/uploads';
import { formatTime } from '../chat/dates';
import type { ChatMessage } from '@viavoip/internal-domain';
import { isTextMessage, previewOf } from '@viavoip/internal-domain';
import { MediaBody, type OpenImage } from './attachments/MediaBody';
import { StatusTicks } from './StatusTicks';

export function MessageBubble({
  message,
  outgoing,
  onRetry,
  showTail,
  upload,
  onOpenImage,
  onCancelUpload,
}: {
  message: ChatMessage;
  outgoing: boolean;
  onRetry?: (messageId: string) => void;
  showTail: boolean;
  upload?: UploadView;
  onOpenImage?: (image: OpenImage, opener: HTMLElement) => void;
  onCancelUpload?: (id: string) => void;
}) {
  if (message.type === 'system') {
    return <p className="system-message" role="status">{message.text}</p>;
  }
  const body = renderBody(message, { upload, onOpenImage, onCancelUpload, onRetry });
  const showGenericRetry = outgoing && message.status === 'error' && onRetry && !upload;
  return (
    <article
      className={`bubble ${outgoing ? 'outgoing' : 'incoming'}${showTail ? ' has-tail' : ''}`}
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
  if (message.type === 'system') return <p className="bubble-text">{message.text}</p>;
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
