export type MediaKind = 'image' | 'audio' | 'video' | 'document';

const validAttachment: unique symbol = Symbol('validAttachment');

export type ValidAttachment = {
  readonly kind: MediaKind;
  readonly file: File;
  readonly fileName: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
  readonly [validAttachment]: true;
};

export type AttachmentRejection =
  | { code: 'multiple' }
  | { code: 'empty'; fileName: string }
  | { code: 'unsupported'; fileName: string }
  | { code: 'mismatch'; fileName: string }
  | { code: 'too-large'; fileName: string; kind: MediaKind; sizeBytes: number; limitBytes: number };

export type AttachmentCheck =
  | { ok: true; attachment: ValidAttachment }
  | { ok: false; rejection: AttachmentRejection };

export type MediaFormat = {
  ext: string;
  mime: string;
  aliases: readonly string[];
};

export type MediaRule = {
  kind: MediaKind;
  label: 'foto' | 'vídeo' | 'áudio' | 'documento';
  maxBytes: number;
  caption: boolean;
  formats: readonly MediaFormat[];
};

const MB = 1024 * 1024;

export const MEDIA_RULES: Readonly<Record<MediaKind, MediaRule>> = {
  image: {
    kind: 'image',
    label: 'foto',
    maxBytes: 5 * MB,
    caption: true,
    formats: [
      { ext: '.jpg', mime: 'image/jpeg', aliases: ['image/pjpeg'] },
      { ext: '.jpeg', mime: 'image/jpeg', aliases: ['image/pjpeg'] },
      { ext: '.png', mime: 'image/png', aliases: [] },
    ],
  },
  video: {
    kind: 'video',
    label: 'vídeo',
    maxBytes: 16 * MB,
    caption: true,
    formats: [
      { ext: '.mp4', mime: 'video/mp4', aliases: [] },
      { ext: '.3gp', mime: 'video/3gpp', aliases: [] },
    ],
  },
  audio: {
    kind: 'audio',
    label: 'áudio',
    maxBytes: 16 * MB,
    caption: false,
    formats: [
      { ext: '.mp3', mime: 'audio/mpeg', aliases: ['audio/mp3'] },
      { ext: '.m4a', mime: 'audio/mp4', aliases: ['audio/x-m4a'] },
      { ext: '.aac', mime: 'audio/aac', aliases: ['audio/x-aac'] },
      { ext: '.amr', mime: 'audio/amr', aliases: [] },
      { ext: '.ogg', mime: 'audio/ogg', aliases: [] },
    ],
  },
  document: {
    kind: 'document',
    label: 'documento',
    maxBytes: 100 * MB,
    caption: false,
    formats: [
      { ext: '.pdf', mime: 'application/pdf', aliases: [] },
      { ext: '.doc', mime: 'application/msword', aliases: [] },
      {
        ext: '.docx',
        mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        aliases: [],
      },
      { ext: '.xls', mime: 'application/vnd.ms-excel', aliases: [] },
      {
        ext: '.xlsx',
        mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        aliases: [],
      },
      { ext: '.ppt', mime: 'application/vnd.ms-powerpoint', aliases: [] },
      {
        ext: '.pptx',
        mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        aliases: [],
      },
      { ext: '.txt', mime: 'text/plain', aliases: [] },
    ],
  },
};

const FORMAT_BY_EXT: ReadonlyMap<string, { kind: MediaKind; format: MediaFormat; maxBytes: number }> = (() => {
  const map = new Map<string, { kind: MediaKind; format: MediaFormat; maxBytes: number }>();
  for (const rule of Object.values(MEDIA_RULES)) {
    for (const format of rule.formats) {
      map.set(format.ext, { kind: rule.kind, format, maxBytes: rule.maxBytes });
    }
  }
  return map;
})();

export const ACCEPT_ATTRIBUTE = uniqueAcceptTokens().join(',');

export const CAPTION_MAX_LENGTH = 1024;

export function splitCaption(value: string): { caption: string; rest: string } {
  if (value.length <= CAPTION_MAX_LENGTH) {
    return { caption: value, rest: '' };
  }
  let caption = '';
  for (const segment of captionSegments(value)) {
    if (caption.length + segment.length > CAPTION_MAX_LENGTH) {
      break;
    }
    caption += segment;
  }
  return { caption, rest: value.slice(caption.length) };
}

export function clampCaption(value: string): string {
  return splitCaption(value).caption;
}

function captionSegments(value: string): string[] {
  if (typeof Intl !== 'undefined' && 'Segmenter' in Intl) {
    const segments: string[] = [];
    for (const part of new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(value)) {
      segments.push(part.segment);
    }
    return segments;
  }
  const points: string[] = [];
  for (const point of value) {
    points.push(point);
  }
  return points;
}

export function extensionForMime(mimeType: string): string | undefined {
  for (const rule of Object.values(MEDIA_RULES)) {
    const format = rule.formats.find((item) => item.mime === mimeType || item.aliases.includes(mimeType));
    if (format) {
      return format.ext;
    }
  }
  return undefined;
}

const UNSUPPORTED_HINT =
  'Envie foto (JPG, PNG), vídeo (MP4, 3GP), áudio (MP3, M4A, AAC, AMR, OGG) ou documento (PDF, DOC, DOCX, XLS, XLSX, PPT, PPTX, TXT).';

export function acceptsCaption(kind: MediaKind): boolean {
  return MEDIA_RULES[kind].caption;
}

export function validateFiles(files: readonly File[]): AttachmentCheck | null {
  if (files.length === 0) {
    return null;
  }
  if (files.length > 1) {
    return { ok: false, rejection: { code: 'multiple' } };
  }
  const file = files[0];
  if (!file) {
    return null;
  }
  const fileName = file.name;
  const ext = extensionOf(fileName);
  const match = ext ? FORMAT_BY_EXT.get(ext) : undefined;
  if (!match) {
    return { ok: false, rejection: { code: 'unsupported', fileName } };
  }
  const allowed = new Set([match.format.mime, ...match.format.aliases]);
  if (file.type && !allowed.has(file.type)) {
    return { ok: false, rejection: { code: 'mismatch', fileName } };
  }
  if (file.size === 0) {
    return { ok: false, rejection: { code: 'empty', fileName } };
  }
  if (file.size > match.maxBytes) {
    return {
      ok: false,
      rejection: {
        code: 'too-large',
        fileName,
        kind: match.kind,
        sizeBytes: file.size,
        limitBytes: match.maxBytes,
      },
    };
  }
  return {
    ok: true,
    attachment: {
      kind: match.kind,
      file,
      fileName,
      mimeType: match.format.mime,
      sizeBytes: file.size,
      [validAttachment]: true,
    },
  };
}

export function rejectionMessage(rejection: AttachmentRejection): string {
  switch (rejection.code) {
    case 'multiple':
      return 'Envie um arquivo por vez.';
    case 'empty':
      return `${rejection.fileName} está vazio.`;
    case 'unsupported':
      return `Formato não suportado: ${rejection.fileName}. ${UNSUPPORTED_HINT}`;
    case 'mismatch':
      return `O conteúdo de ${rejection.fileName} não corresponde à extensão do arquivo.`;
    case 'too-large':
      return `${rejection.fileName} tem ${formatBytes(rejection.sizeBytes)}. O limite para ${MEDIA_RULES[rejection.kind].label} é ${formatBytes(rejection.limitBytes)}.`;
    default: {
      const exhaustive: never = rejection;
      return exhaustive;
    }
  }
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${String(bytes)} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${formatDecimal(bytes / 1024)} KB`;
  }
  const mega = bytes / (1024 * 1024);
  const rounded = Math.round(mega * 10) / 10;
  if (Number.isInteger(rounded)) {
    return `${String(rounded)} MB`;
  }
  return `${formatDecimal(mega)} MB`;
}

function formatDecimal(value: number): string {
  return (Math.round(value * 10) / 10).toFixed(1).replace('.', ',');
}

function extensionOf(fileName: string): string | undefined {
  const dot = fileName.lastIndexOf('.');
  if (dot <= -1 || dot === fileName.length - 1) {
    return undefined;
  }
  return fileName.slice(dot).toLowerCase();
}

function uniqueAcceptTokens(): string[] {
  const tokens: string[] = [];
  const seen = new Set<string>();
  function add(token: string) {
    if (seen.has(token)) {
      return;
    }
    seen.add(token);
    tokens.push(token);
  }
  for (const rule of Object.values(MEDIA_RULES)) {
    for (const format of rule.formats) {
      add(format.ext);
      add(format.mime);
    }
  }
  return tokens;
}
