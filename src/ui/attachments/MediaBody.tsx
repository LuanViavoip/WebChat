import type { UploadView } from '../../chat/uploads';
import { extensionForMime } from '../../domain/attachment';
import type { ChatMessage, ImageMessage, TextMessage } from '../../domain/message';
import { DocumentCard } from './DocumentCard';
import { UploadStatus } from './UploadStatus';

export type OpenImage = { url: string; alt: string; fileName: string; messageId: string };

export function MediaBody({
  message,
  upload,
  onOpenImage,
  onCancelUpload,
  onRetry,
}: {
  message: Exclude<ChatMessage, TextMessage>;
  upload?: UploadView;
  onOpenImage?: (image: OpenImage, opener: HTMLElement) => void;
  onCancelUpload?: (id: string) => void;
  onRetry?: (id: string) => void;
}) {
  const fileName = uploadFileName(message, upload);
  return (
    <>
      {renderMedia(message, onOpenImage)}
      {upload && onCancelUpload && onRetry ? (
        <UploadStatus
          messageId={message.id}
          fileName={fileName}
          upload={upload}
          onCancel={onCancelUpload}
          onRetry={onRetry}
        />
      ) : null}
    </>
  );
}

function renderMedia(
  message: Exclude<ChatMessage, TextMessage>,
  onOpenImage?: (image: OpenImage, opener: HTMLElement) => void,
) {
  switch (message.type) {
    case 'image': {
      const alt = message.caption || `Foto de ${message.author.name}`;
      return (
        <div className="bubble-media">
          <button
            type="button"
            className="bubble-image-button"
            aria-label="Abrir foto em tela cheia"
            onClick={(event) => {
              onOpenImage?.({ url: message.url, alt, fileName: imageDownloadName(message), messageId: message.id }, event.currentTarget);
            }}
          >
            <img className="bubble-image" src={message.url} alt={alt} loading="lazy" />
          </button>
          {message.caption ? <p className="bubble-text">{message.caption}</p> : null}
        </div>
      );
    }
    case 'video':
      return (
        <div className="bubble-media">
          {/* eslint-disable-next-line jsx-a11y/media-has-caption -- mídia enviada pelo usuário */}
          <video
            className="bubble-video"
            src={message.url}
            controls
            preload="metadata"
            playsInline
            aria-label={`Vídeo de ${message.author.name}`}
          />
          {message.caption ? <p className="bubble-text">{message.caption}</p> : null}
        </div>
      );
    case 'audio':
      return (
        // eslint-disable-next-line jsx-a11y/media-has-caption -- mídia enviada pelo usuário
        <audio
          className="bubble-audio"
          src={message.url}
          controls
          preload="metadata"
          aria-label={`Áudio de ${message.author.name}`}
        />
      );
    case 'document':
      return <DocumentCard fileName={message.fileName} url={message.url} sizeBytes={message.sizeBytes} />;
    case 'sticker':
      return <p className="bubble-text">Mensagem de sticker ainda não suportada nesta etapa.</p>;
    default: {
      const exhaustive: never = message;
      return exhaustive;
    }
  }
}

function imageDownloadName(message: ImageMessage): string {
  const ext = extensionForMime(message.mimeType);
  return ext ? `foto${ext}` : 'foto';
}

function uploadFileName(message: Exclude<ChatMessage, TextMessage>, upload?: UploadView): string {
  if (upload?.phase === 'uploading') {
    return upload.fileName;
  }
  if (upload?.phase === 'failed') {
    return upload.fileName;
  }
  if (message.type === 'document') {
    return message.fileName;
  }
  switch (message.type) {
    case 'image':
      return 'foto';
    case 'video':
      return 'vídeo';
    case 'audio':
      return 'áudio';
    case 'sticker':
      return 'figurinha';
    default: {
      const exhaustive: never = message;
      return exhaustive;
    }
  }
}
