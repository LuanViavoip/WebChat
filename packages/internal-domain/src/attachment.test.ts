import {
  ACCEPT_ATTRIBUTE,
  ANNOUNCEMENT_VIDEO_MAX_MS,
  AUDIO_MAX_MS,
  CAPTION_MAX_LENGTH,
  MEDIA_RULES,
  clampCaption,
  extensionForMime,
  splitCaption,
  formatBytes,
  rejectionMessage,
  validateFiles,
  type MediaKind,
} from './attachment';

const MB = 1024 * 1024;

function isWellFormed(value: string): boolean {
  try {
    encodeURIComponent(value);
    return true;
  } catch {
    return false;
  }
}

const TABLE: Array<{
  ext: string;
  mime: string;
  aliases: readonly string[];
  kind: MediaKind;
}> = [
  { ext: '.jpg', mime: 'image/jpeg', aliases: ['image/pjpeg'], kind: 'image' },
  { ext: '.jpeg', mime: 'image/jpeg', aliases: ['image/pjpeg'], kind: 'image' },
  { ext: '.png', mime: 'image/png', aliases: [], kind: 'image' },
  { ext: '.mp4', mime: 'video/mp4', aliases: [], kind: 'video' },
  { ext: '.3gp', mime: 'video/3gpp', aliases: [], kind: 'video' },
  { ext: '.mp3', mime: 'audio/mpeg', aliases: ['audio/mp3'], kind: 'audio' },
  { ext: '.m4a', mime: 'audio/mp4', aliases: ['audio/x-m4a'], kind: 'audio' },
  { ext: '.aac', mime: 'audio/aac', aliases: ['audio/x-aac'], kind: 'audio' },
  { ext: '.amr', mime: 'audio/amr', aliases: [], kind: 'audio' },
  { ext: '.ogg', mime: 'audio/ogg', aliases: [], kind: 'audio' },
  { ext: '.pdf', mime: 'application/pdf', aliases: [], kind: 'document' },
  { ext: '.doc', mime: 'application/msword', aliases: [], kind: 'document' },
  {
    ext: '.docx',
    mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    aliases: [],
    kind: 'document',
  },
  { ext: '.xls', mime: 'application/vnd.ms-excel', aliases: [], kind: 'document' },
  {
    ext: '.xlsx',
    mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    aliases: [],
    kind: 'document',
  },
  { ext: '.ppt', mime: 'application/vnd.ms-powerpoint', aliases: [], kind: 'document' },
  {
    ext: '.pptx',
    mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    aliases: [],
    kind: 'document',
  },
  { ext: '.txt', mime: 'text/plain', aliases: [], kind: 'document' },
];

function fileOf(name: string, type: string, size = 32): File {
  return new File([new Uint8Array(size)], name, { type });
}

describe('validateFiles', () => {
  it.each([
    ['audio.webm', 'audio/webm', 'audio'],
    ['audio.ogg', 'audio/ogg;codecs=opus', 'audio'],
    ['video.webm', 'video/webm', 'video'],
  ] as const)('aceita gravação %s com MIME %s', (name, mime, kind) => {
    expect(validateFiles([fileOf(name, mime)])).toMatchObject({ ok: true, attachment: { kind } });
  });
  it.each(TABLE)('aceita $ext com MIME canônico $mime', ({ ext, mime, kind }) => {
    const result = validateFiles([fileOf(`arquivo${ext}`, mime)]);
    expect(result?.ok).toBe(true);
    if (!result?.ok) {
      throw new Error('esperava anexo válido');
    }
    expect(result.attachment.kind).toBe(kind);
    expect(result.attachment.mimeType).toBe(mime);
    expect(result.attachment.sizeBytes).toBe(32);
    expect(result.attachment.fileName).toBe(`arquivo${ext}`);
  });

  it.each(TABLE.flatMap((row) => row.aliases.map((alias) => ({ ...row, alias }))))(
    'aceita alias $alias para $ext e normaliza para $mime',
    ({ ext, mime, kind, alias }) => {
      const result = validateFiles([fileOf(`arquivo${ext}`, alias)]);
      expect(result?.ok).toBe(true);
      if (!result?.ok) {
        throw new Error('esperava anexo válido');
      }
      expect(result.attachment.kind).toBe(kind);
      expect(result.attachment.mimeType).toBe(mime);
    },
  );

  it('aceita extensão em maiúsculas', () => {
    const result = validateFiles([fileOf('EXAME.PDF', 'application/pdf')]);
    expect(result?.ok).toBe(true);
    if (!result?.ok) {
      throw new Error('esperava pdf');
    }
    expect(result.attachment.kind).toBe('document');
    expect(result.attachment.mimeType).toBe('application/pdf');
  });

  it('usa a última extensão em nomes com vários pontos', () => {
    const result = validateFiles([fileOf('a.b.png', 'image/png')]);
    expect(result?.ok).toBe(true);
    if (!result?.ok) {
      throw new Error('esperava png');
    }
    expect(result.attachment.kind).toBe('image');
    expect(result.attachment.mimeType).toBe('image/png');
  });

  it('aceita file.type vazio pela extensão', () => {
    const result = validateFiles([fileOf('voz.amr', '')]);
    expect(result?.ok).toBe(true);
    if (!result?.ok) {
      throw new Error('esperava amr');
    }
    expect(result.attachment.mimeType).toBe('audio/amr');
  });

  it.each(['.webp', '.gif', '.heic', '.svg', '.exe', ''])('rejeita formato %s', (ext) => {
    const name = ext ? `arquivo${ext}` : 'semextensao';
    const result = validateFiles([fileOf(name, '')]);
    expect(result?.ok).toBe(false);
    if (!result || result.ok) {
      throw new Error('esperava rejeição');
    }
    expect(result.rejection).toEqual({ code: 'unsupported', fileName: name });
    expect(rejectionMessage(result.rejection)).toBe(
      `Formato não suportado: ${name}. Envie foto (JPG, PNG), vídeo (MP4, 3GP), áudio (MP3, M4A, AAC, AMR, OGG) ou documento (PDF, DOC, DOCX, XLS, XLSX, PPT, PPTX, TXT).`,
    );
  });

  it('rejeita MIME incompatível com a extensão', () => {
    const result = validateFiles([fileOf('foto.png', 'application/pdf')]);
    expect(result?.ok).toBe(false);
    if (!result || result.ok) {
      throw new Error('esperava mismatch');
    }
    expect(result.rejection).toEqual({ code: 'mismatch', fileName: 'foto.png' });
    expect(rejectionMessage(result.rejection)).toBe(
      'O conteúdo de foto.png não corresponde à extensão do arquivo.',
    );
  });

  it('rejeita arquivo vazio', () => {
    const result = validateFiles([fileOf('vazio.txt', 'text/plain', 0)]);
    expect(result?.ok).toBe(false);
    if (!result || result.ok) {
      throw new Error('esperava empty');
    }
    expect(result.rejection).toEqual({ code: 'empty', fileName: 'vazio.txt' });
    expect(rejectionMessage(result.rejection)).toBe('vazio.txt está vazio.');
  });

  it('aceita o limite exato de cada tipo', () => {
    expect(validateFiles([fileOf('foto.png', 'image/png', 5 * MB)])?.ok).toBe(true);
    expect(validateFiles([fileOf('clip.mp4', 'video/mp4', 16 * MB)])?.ok).toBe(true);
    expect(validateFiles([fileOf('voz.mp3', 'audio/mpeg', 16 * MB)])?.ok).toBe(true);
    expect(validateFiles([fileOf('guia.pdf', 'application/pdf', 100 * MB)])?.ok).toBe(true);
  });

  it.each([
    { name: 'exame.png', type: 'image/png', size: 5 * MB + 1, kind: 'image' as const, label: 'foto', limit: '5 MB' },
    { name: 'clip.mp4', type: 'video/mp4', size: 16 * MB + 1, kind: 'video' as const, label: 'vídeo', limit: '16 MB' },
    { name: 'voz.mp3', type: 'audio/mpeg', size: 16 * MB + 1, kind: 'audio' as const, label: 'áudio', limit: '16 MB' },
    {
      name: 'guia.pdf',
      type: 'application/pdf',
      size: 100 * MB + 1,
      kind: 'document' as const,
      label: 'documento',
      limit: '100 MB',
    },
  ])('rejeita $name acima do limite de $label', ({ name, type, size, kind, label, limit }) => {
    const result = validateFiles([fileOf(name, type, size)]);
    expect(result?.ok).toBe(false);
    if (!result || result.ok) {
      throw new Error('esperava too-large');
    }
    expect(result.rejection).toEqual({
      code: 'too-large',
      fileName: name,
      kind,
      sizeBytes: size,
      limitBytes: MEDIA_RULES[kind].maxBytes,
    });
    expect(rejectionMessage(result.rejection)).toBe(
      `${name} tem ${formatBytes(size)}. O limite para ${label} é ${limit}.`,
    );
  });

  it('não faz nada com lista vazia', () => {
    expect(validateFiles([])).toBeNull();
  });

  it('rejeita dois arquivos', () => {
    const result = validateFiles([fileOf('a.png', 'image/png'), fileOf('b.png', 'image/png')]);
    expect(result?.ok).toBe(false);
    if (!result || result.ok) {
      throw new Error('esperava multiple');
    }
    expect(result.rejection).toEqual({ code: 'multiple' });
    expect(rejectionMessage(result.rejection)).toBe('Envie um arquivo por vez.');
  });
});

describe('formatBytes', () => {
  it('formata com base 1024 em pt-BR', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(1023)).toBe('1023 B');
    expect(formatBytes(1024)).toBe('1,0 KB');
    expect(formatBytes(Math.round(7.2 * MB))).toBe('7,2 MB');
    expect(formatBytes(5 * MB)).toBe('5 MB');
    expect(formatBytes(100 * MB)).toBe('100 MB');
  });
});

describe('ACCEPT_ATTRIBUTE', () => {
  it('contém todas as extensões e MIMEs canônicos', () => {
    for (const row of TABLE) {
      expect(ACCEPT_ATTRIBUTE).toContain(row.ext);
      expect(ACCEPT_ATTRIBUTE).toContain(row.mime);
    }
  });
});

describe('clampCaption', () => {
  it('corta em CAPTION_MAX_LENGTH', () => {
    expect(clampCaption('ok')).toBe('ok');
    expect(clampCaption('x'.repeat(CAPTION_MAX_LENGTH + 8))).toHaveLength(CAPTION_MAX_LENGTH);
  });

  it('não parte um emoji nas posições 1023-1024', () => {
    const draft = `${'a'.repeat(1023)}😀fim`;
    const { caption, rest } = splitCaption(draft);
    expect(caption + rest).toBe(draft);
    expect(isWellFormed(caption)).toBe(true);
    expect(isWellFormed(rest)).toBe(true);
    expect(caption).toBe('a'.repeat(1023));
    expect(rest.startsWith('😀')).toBe(true);
  });

  it('não parte um emoji ZWJ no limite da legenda', () => {
    const family = '👨‍👩‍👧‍👦';
    const draft = `${'a'.repeat(1022)}${family}fim`;
    const { caption, rest } = splitCaption(draft);
    expect(caption + rest).toBe(draft);
    expect(isWellFormed(caption)).toBe(true);
    expect(isWellFormed(rest)).toBe(true);
    expect(caption).toBe('a'.repeat(1022));
    expect(rest.startsWith(family)).toBe(true);
  });
});

describe('extensionForMime', () => {
  it('usa a extensão canônica do MIME', () => {
    expect(extensionForMime('image/png')).toBe('.png');
    expect(extensionForMime('image/jpeg')).toBe('.jpg');
    expect(extensionForMime('image/pjpeg')).toBe('.jpg');
  });
});

describe('limites de duração (D-V1-5)', () => {
  it('exporta 15 min de áudio e 5 min de vídeo de aviso', () => {
    expect(AUDIO_MAX_MS).toBe(15 * 60_000);
    expect(ANNOUNCEMENT_VIDEO_MAX_MS).toBe(5 * 60_000);
  });
});
