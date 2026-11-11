import type { UploadView } from '../../chat/uploads';

export function UploadStatus({
  messageId,
  fileName,
  upload,
  onCancel,
  onRetry,
  sessionEnded = false,
}: {
  messageId: string;
  fileName: string;
  upload: UploadView;
  onCancel: (id: string) => void;
  onRetry: (id: string) => void;
  sessionEnded?: boolean;
}) {
  if (upload.phase === 'uploading') {
    return (
      <div className="upload-status">
        <progress max={upload.total} value={upload.loaded} aria-label={`Enviando ${fileName}`} />
        {sessionEnded ? null : (
          <button
            type="button"
            className="retry-button"
            aria-label={`Cancelar envio de ${fileName}`}
            onClick={() => {
              onCancel(messageId);
            }}
          >
            Cancelar
          </button>
        )}
      </div>
    );
  }
  return (
    <div className="upload-status">
      <p role="alert">{upload.message}</p>
      {sessionEnded ? (
        <p>Atendimento encerrado</p>
      ) : (
        <>
          <button
            type="button"
            className="retry-button"
            aria-label={`Tentar enviar ${fileName} de novo`}
            onClick={() => {
              onRetry(messageId);
            }}
          >
            Tentar de novo
          </button>
          <button
            type="button"
            className="retry-button"
            aria-label={`Descartar ${fileName}`}
            onClick={() => {
              onCancel(messageId);
            }}
          >
            Descartar
          </button>
        </>
      )}
    </div>
  );
}
