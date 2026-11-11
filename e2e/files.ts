const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

const PDF_MIN = Buffer.from('%PDF-1.1\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');

export function pngFile(name = 'foto.png') {
  return { name, mimeType: 'image/png', buffer: PNG_1X1 };
}

export function pdfFile(name = 'guia.pdf') {
  return { name, mimeType: 'application/pdf', buffer: PDF_MIN };
}

export function audioFile(name = 'voz.mp3') {
  return { name, mimeType: 'audio/mpeg', buffer: Buffer.from([0xff, 0xfb, 0x90, 0x00]) };
}

export function videoFile(name = 'clip.mp4') {
  return { name, mimeType: 'video/mp4', buffer: Buffer.from([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70]) };
}

export function exeFile(name = 'virus.exe') {
  return { name, mimeType: 'application/octet-stream', buffer: Buffer.from([0x4d, 0x5a]) };
}

export function oversizedPng(name = 'grande.png') {
  return { name, mimeType: 'image/png', buffer: Buffer.alloc(5 * 1024 * 1024 + 1, 1) };
}
