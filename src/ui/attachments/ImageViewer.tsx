import { Download, X } from 'lucide-react';
import { useEffect, useRef } from 'react';

export function ImageViewer({
  image,
  onClose,
}: {
  image: { url: string; alt: string; fileName: string } | null;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog || !image) {
      return;
    }
    if (!dialog.open) {
      dialog.showModal();
    }
    closeRef.current?.focus();
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, [image, onClose]);

  if (!image) {
    return null;
  }

  return (
    <dialog
      ref={dialogRef}
      className="image-viewer"
      aria-label="Foto em tela cheia"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <button
        type="button"
        className="image-viewer-backdrop"
        tabIndex={-1}
        aria-hidden="true"
        onClick={onClose}
      />
      <div className="image-viewer-bar">
        <button
          ref={closeRef}
          type="button"
          className="icon-button"
          aria-label="Fechar foto"
          onClick={onClose}
        >
          <X size={22} strokeWidth={1.8} aria-hidden="true" />
        </button>
        <a className="icon-button" href={image.url} download={image.fileName} aria-label="Baixar foto">
          <Download size={20} strokeWidth={1.8} aria-hidden="true" />
        </a>
      </div>
      <div className="image-viewer-stage">
        <img src={image.url} alt={image.alt} />
      </div>
    </dialog>
  );
}
