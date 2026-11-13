import { FileText } from 'lucide-react';
import { formatBytes } from '../../domain/attachment';

export function DocumentCard({
  fileName,
  url,
  sizeBytes,
}: {
  fileName: string;
  url: string;
  sizeBytes?: number;
}) {
  const ext = extensionLabel(fileName);
  const sizeLabel = sizeBytes === undefined ? undefined : formatBytes(sizeBytes);
  const meta = sizeLabel ? `${ext} · ${sizeLabel}` : ext;
  const downloadLabel = sizeLabel ? `Baixar ${fileName}, ${ext}, ${sizeLabel}` : `Baixar ${fileName}, ${ext}`;
  return (
    <div className="doc-card">
      <FileText size={28} strokeWidth={1.7} aria-hidden="true" />
      <div className="doc-card-copy">
        <p className="doc-card-name">{fileName}</p>
        <p className="doc-card-meta">{meta}</p>
      </div>
      <a className="doc-card-download" href={url} download={fileName} aria-label={downloadLabel}>
        Baixar
      </a>
    </div>
  );
}

function extensionLabel(fileName: string): string {
  const dot = fileName.lastIndexOf('.');
  if (dot <= -1 || dot === fileName.length - 1) {
    return 'ARQ';
  }
  return fileName.slice(dot + 1).toUpperCase();
}
