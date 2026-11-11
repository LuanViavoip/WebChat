/** Contraste WCAG 2.x relativo a cores hex #RRGGBB. */

const HEX_PATTERN = /^#?([\da-fA-F]{6})$/;
const RGB_PATTERN = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/;

export function hexToRgb(hex: string): readonly [number, number, number] {
  const match = HEX_PATTERN.exec(hex.trim());
  if (!match?.[1]) {
    throw new Error(`Cor hex inválida: ${hex}`);
  }
  const value = Number.parseInt(match[1], 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

function toHexByte(channel: number): string {
  return channel.toString(16).padStart(2, '0');
}

export function cssColorToHex(color: string): string {
  const trimmed = color.trim();
  const hex = HEX_PATTERN.exec(trimmed);
  if (hex?.[1]) {
    return `#${hex[1].toUpperCase()}`;
  }
  const rgb = RGB_PATTERN.exec(trimmed);
  if (rgb) {
    const red = Number(rgb[1]);
    const green = Number(rgb[2]);
    const blue = Number(rgb[3]);
    return `#${toHexByte(red)}${toHexByte(green)}${toHexByte(blue)}`.toUpperCase();
  }
  throw new Error(`Cor CSS não suportada: ${color}`);
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

export function contrastRatioFromCss(foreground: string, background: string): number {
  return contrastRatio(cssColorToHex(foreground), cssColorToHex(background));
}

export function readRootVars(css: string): Record<string, string> {
  const block = /:root\s*\{([^}]+)\}/.exec(css);
  if (!block?.[1]) {
    throw new Error('Bloco :root não encontrado');
  }
  const vars: Record<string, string> = {};
  for (const line of block[1].split(';')) {
    const match = /(--[\w-]+)\s*:\s*([^;]+)/.exec(line);
    if (match?.[1] && match[2]) {
      vars[match[1]] = match[2].trim();
    }
  }
  return vars;
}

export function resolveCssColor(value: string, vars: Record<string, string>): string {
  const trimmed = value.trim();
  const variable = /^var\((--[\w-]+)\)$/.exec(trimmed);
  if (variable?.[1]) {
    const next = vars[variable[1]];
    if (!next) {
      throw new Error(`Variável CSS ausente: ${variable[1]}`);
    }
    return resolveCssColor(next, vars);
  }
  return cssColorToHex(trimmed);
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
  { name: 'erro em faixa', foreground: '#B42318', background: '#FFF5F5', minimum: 4.5 },
];
