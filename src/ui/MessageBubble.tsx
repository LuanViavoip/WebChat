import type { UploadView } from '../chat/uploads';
import { formatTime } from '../chat/dates';
import type { ChatMessage, MenuOption } from '../domain/message';
import { isTextMessage, previewOf } from '../domain/message';
import { MediaBody, type OpenImage } from './attachments/MediaBody';
import { StatusTicks } from './StatusTicks';

export function MessageBubble({
  message,
  onRetry,
  showTail,
  menu,
  menuDisabled,
  onMenuSelect,
  upload,
  onOpenImage,
  onCancelUpload,
  sessionEnded = false,
}: {
  message: ChatMessage;
  onRetry?: (messageId: string) => void;
  showTail: boolean;
  menu?: MenuOption[];
  menuDisabled?: boolean;
  onMenuSelect?: (option: MenuOption) => void;
  upload?: UploadView;
  onOpenImage?: (image: OpenImage, opener: HTMLElement) => void;
  onCancelUpload?: (id: string) => void;
  sessionEnded?: boolean;
}) {
  const outgoing = message.direction === 'client';
  const body = renderBody(message, { upload, onOpenImage, onCancelUpload, onRetry, sessionEnded });
  const hasMenu = Boolean(menu && menu.length > 0 && onMenuSelect);
  const showGenericRetry = outgoing && message.status === 'error' && onRetry && !upload && !sessionEnded;
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

function renderBody(
  message: ChatMessage,
  extras: {
    upload?: UploadView;
    onOpenImage?: (image: OpenImage, opener: HTMLElement) => void;
    onCancelUpload?: (id: string) => void;
    onRetry?: (id: string) => void;
    sessionEnded?: boolean;
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
      {...(extras.sessionEnded ? { sessionEnded: extras.sessionEnded } : {})}
    />
  );
}
