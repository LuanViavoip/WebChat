import { SendHorizontal, X } from 'lucide-react';
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import {
  CAPTION_MAX_LENGTH,
  acceptsCaption,
  clampCaption,
  formatBytes,
  type ValidAttachment,
} from '../../domain/attachment';
import { DocumentCard } from './DocumentCard';
import { useObjectUrl } from './useObjectUrl';

export function AttachmentPreview({
  attachment,
  initialCaption,
  onSend,
  onCancel,
  disabled,
}: {
  attachment: ValidAttachment;
  initialCaption: string;
  onSend: (caption: string | undefined) => void;
  onCancel: () => void;
  disabled: boolean;
}) {
  const captionEnabled = acceptsCaption(attachment.kind);
  const [caption, setCaption] = useState(() => clampCaption(initialCaption));
  const url = useObjectUrl(attachment.file);
  const captionRef = useRef<HTMLTextAreaElement>(null);
  const sendRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (captionEnabled) {
      captionRef.current?.focus();
      return;
    }
    sendRef.current?.focus();
  }, [captionEnabled]);

  useEffect(() => {
    function onKey(event: globalThis.KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault();
        onCancel();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, [onCancel]);

  function submit() {
    if (disabled) {
      return;
    }
    const next = caption.trim();
    onSend(next.length > 0 ? next : undefined);
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.nativeEvent.isComposing) {
      return;
    }
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      submit();
    }
  }

  return (
    <div className="attachment-preview" role="region" aria-label="Pré-visualização do anexo">
      <div className="attachment-preview-body">
        {url ? renderPreview(attachment, url) : null}
        <p className="attachment-preview-meta">
          {attachment.fileName} · {formatBytes(attachment.sizeBytes)}
        </p>
      </div>
      <div className="composer">
        <div className="composer-row">
          <button type="button" className="icon-button" aria-label="Cancelar anexo" onClick={onCancel}>
            <X size={22} strokeWidth={1.6} aria-hidden="true" />
          </button>
          {captionEnabled ? (
            <label className="composer-field">
              <span className="sr-only">Legenda</span>
              <textarea
                ref={captionRef}
                value={caption}
                maxLength={CAPTION_MAX_LENGTH}
                rows={1}
                disabled={disabled}
                placeholder="Adicione uma legenda"
                aria-label="Legenda"
                onChange={(event) => {
                  setCaption(event.target.value);
                }}
                onKeyDown={onKeyDown}
              />
            </label>
          ) : (
            <div className="composer-field" />
          )}
          <button
            ref={sendRef}
            type="button"
            className="send-fab"
            aria-label="Enviar"
            disabled={disabled}
            onClick={submit}
          >
            <SendHorizontal size={20} strokeWidth={2} aria-hidden="true" />
          </button>
        </div>
      </div>
    </div>
  );
}

function renderPreview(attachment: ValidAttachment, url: string) {
  switch (attachment.kind) {
    case 'image':
      return <img src={url} alt={`Pré-visualização de ${attachment.fileName}`} />;
    case 'video':
      // Conteúdo do usuário: sem legendas geradas nesta etapa.
      // eslint-disable-next-line jsx-a11y/media-has-caption -- player nativo do arquivo enviado
      return <video src={url} controls preload="metadata" />;
    case 'audio':
      // eslint-disable-next-line jsx-a11y/media-has-caption -- player nativo do arquivo enviado
      return <audio src={url} controls />;
    case 'document':
      return <DocumentCard fileName={attachment.fileName} url={url} sizeBytes={attachment.sizeBytes} />;
    default: {
      const exhaustive: never = attachment.kind;
      return exhaustive;
    }
  }
}
