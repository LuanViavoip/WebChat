import type { ReactNode } from 'react';
import type { UploadView } from '../chat/uploads';
import { formatTime } from '../chat/dates';
import type { AnnouncementRefMessage, ChatMessage } from '@viavoip/internal-domain';
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
  showAuthor = false,
  renderAnnouncement,
}: {
  message: ChatMessage;
  outgoing: boolean;
  onRetry?: (messageId: string) => void;
  showTail: boolean;
  upload?: UploadView;
  onOpenImage?: (image: OpenImage, opener: HTMLElement) => void;
  onCancelUpload?: (id: string) => void;
  showAuthor?: boolean;
  renderAnnouncement?: (message: AnnouncementRefMessage) => ReactNode;
}) {
  if (message.type === 'system') {
    return <p className="system-message" role="status">{message.text}</p>;
  }
  const body = renderBody(message, { upload, onOpenImage, onCancelUpload, onRetry, renderAnnouncement });
  const showGenericRetry = outgoing && message.status === 'error' && onRetry && !upload;
  return (
    <article
      className={`bubble ${outgoing ? 'outgoing' : 'incoming'}${showTail ? ' has-tail' : ''}`}
      aria-label={`${message.author.name}: ${previewOf(message)}`}
    >
      {showAuthor ? <span className="group-author">{message.author.name}</span> : null}
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
    renderAnnouncement?: (message: AnnouncementRefMessage) => ReactNode;
  },
) {
  if (message.type === 'system') return <p className="bubble-text">{message.text}</p>;
  if (isTextMessage(message)) {
    return <p className="bubble-text">{message.text}</p>;
  }
  if (message.type === 'deleted') {
    return <p className="bubble-text">Mensagem apagada</p>;
  }
  if (message.type === 'announcement') {
    return extras.renderAnnouncement ? (
      extras.renderAnnouncement(message)
    ) : (
      <p className="bubble-text">Aviso encaminhado</p>
    );
  }
  if (message.type === 'poll') {
    return <p className="bubble-text">{`📊 ${message.question}`}</p>;
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
