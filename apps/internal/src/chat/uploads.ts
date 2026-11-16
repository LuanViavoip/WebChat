import type { ValidAttachment } from '@viavoip/internal-domain';

export type UploadView =
  | { phase: 'uploading'; loaded: number; total: number; fileName: string }
  | { phase: 'failed'; message: string; fileName: string };

export type UploadEntry = {
  readonly attachment: ValidAttachment;
  readonly caption: string | undefined;
  readonly previewUrl: string;
  readonly attempt: number;
  readonly view: UploadView;
};

export type UploadEvent =
  | { type: 'progress'; attempt: number; loaded: number }
  | { type: 'fail'; attempt: number; message: string }
  | { type: 'retry' }
  | { type: 'succeed'; attempt: number }
  | { type: 'cancel' };

export function beginUpload(
  attachment: ValidAttachment,
  caption: string | undefined,
  previewUrl: string,
): UploadEntry {
  return {
    attachment,
    caption,
    previewUrl,
    attempt: 1,
    view: {
      phase: 'uploading',
      loaded: 0,
      total: attachment.sizeBytes,
      fileName: attachment.fileName,
    },
  };
}

export function nextUpload(entry: UploadEntry, event: UploadEvent): UploadEntry | 'removed' {
  switch (event.type) {
    case 'progress': {
      if (entry.view.phase !== 'uploading' || event.attempt !== entry.attempt) {
        return entry;
      }
      const loaded = Math.min(entry.view.total, Math.max(entry.view.loaded, event.loaded));
      if (loaded === entry.view.loaded) {
        return entry;
      }
      return {
        ...entry,
        view: {
          phase: 'uploading',
          loaded,
          total: entry.view.total,
          fileName: entry.view.fileName,
        },
      };
    }
    case 'fail': {
      if (entry.view.phase !== 'uploading' || event.attempt !== entry.attempt) {
        return entry;
      }
      return {
        ...entry,
        view: { phase: 'failed', message: event.message, fileName: entry.attachment.fileName },
      };
    }
    case 'retry': {
      if (entry.view.phase !== 'failed') {
        return entry;
      }
      return {
        ...entry,
        attempt: entry.attempt + 1,
        view: {
          phase: 'uploading',
          loaded: 0,
          total: entry.attachment.sizeBytes,
          fileName: entry.attachment.fileName,
        },
      };
    }
    case 'succeed': {
      if (entry.view.phase !== 'uploading' || event.attempt !== entry.attempt) {
        return entry;
      }
      return 'removed';
    }
    case 'cancel':
      return 'removed';
    default: {
      const exhaustive: never = event;
      return exhaustive;
    }
  }
}
