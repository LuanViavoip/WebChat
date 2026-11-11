/** Contraste WCAG 2.x relativo a cores hex #RRGGBB. */

export function hexToRgb(hex: string): readonly [number, number, number] {
  const normalized = hex.trim().replace('#', '');
  if (!/^[\da-fA-F]{6}$/.test(normalized)) {
    throw new Error(`Cor hex inválida: ${hex}`);
  }
  const value = Number.parseInt(normalized, 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

function channelLuminance(channel: number): number {
  const srgb = channel / 255;
  return srgb <= 0.04045 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
}

export function relativeLuminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex);
  return 0.2126 * channelLuminance(r) + 0.7152 * channelLuminance(g) + 0.0722 * channelLuminance(b);
}

export function contrastRatio(foreground: string, background: string): number {
  const lighter = Math.max(relativeLuminance(foreground), relativeLuminance(background));
  const darker = Math.min(relativeLuminance(foreground), relativeLuminance(background));
  return (lighter + 0.05) / (darker + 0.05);
}

export type ContrastPair = {
  name: string;
  foreground: string;
  background: string;
  minimum: number;
};

/** Pares realmente usados no tema semântico ViaVoip. */
export const USED_CONTRAST_PAIRS: ContrastPair[] = [
  { name: 'texto em superfície', foreground: '#0F1B3D', background: '#FFFFFF', minimum: 4.5 },
  { name: 'texto em superfície suave', foreground: '#0F1B3D', background: '#F5F7FF', minimum: 4.5 },
  { name: 'texto mudo em branco', foreground: '#6B7495', background: '#FFFFFF', minimum: 4.5 },
  { name: 'texto auxiliar em suave', foreground: '#3D4869', background: '#F5F7FF', minimum: 4.5 },
  { name: 'texto auxiliar em balão enviado', foreground: '#3D4869', background: '#EEF2FF', minimum: 4.5 },
  { name: 'texto auxiliar em balão recebido', foreground: '#3D4869', background: '#FFFFFF', minimum: 4.5 },
  { name: 'branco em acento', foreground: '#FFFFFF', background: '#2E5BFF', minimum: 4.5 },
  { name: 'branco em acento forte', foreground: '#FFFFFF', background: '#1E3FCC', minimum: 4.5 },
  { name: 'branco no ink', foreground: '#FFFFFF', background: '#0F1B3D', minimum: 4.5 },
  { name: 'branco no deep', foreground: '#FFFFFF', background: '#16265C', minimum: 4.5 },
  { name: 'tick de lida no balão enviado', foreground: '#1E3FCC', background: '#EEF2FF', minimum: 4.5 },
  { name: 'ícone em superfície', foreground: '#3D4869', background: '#FFFFFF', minimum: 3 },
  { name: 'ícone no cabeçalho', foreground: '#FFFFFF', background: '#0F1B3D', minimum: 3 },
  { name: 'lima no ink', foreground: '#A3E635', background: '#0F1B3D', minimum: 3 },
  { name: 'badge de não lidas', foreground: '#FFFFFF', background: '#2E5BFF', minimum: 4.5 },
];
