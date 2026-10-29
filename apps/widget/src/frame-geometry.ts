/**
 * Geometria do iframe do widget, calculada pelo loader a partir do viewport do SITE (host).
 * O widget só informa se está aberto ou fechado; nunca mede o próprio iframe.
 */
export type FrameMode = 'launcher' | 'panel';
export type Viewport = { width: number; height: number };
export type Offsets = { bottom: number; right: number };

export type FrameGeometry = {
  mode: FrameMode;
  width: number;
  height: number;
  right: number;
  bottom: number;
  /** Painel ocupando a tela inteira (celulares). */
  fullscreen: boolean;
};

/** Iframe do botão: 72px de botão mais 8px de folga por lado para sombra e anel de foco. */
export const LAUNCHER_FRAME = 88;
export const LAUNCHER_INSET = 8;
export const PANEL_WIDTH = 400;
export const PANEL_HEIGHT = 640;
export const PANEL_MARGIN = 16;
export const MOBILE_MAX_WIDTH = 640;
export const DEFAULT_OFFSET = 16;
const MIN_PANEL = 200;

export function frameGeometry(mode: FrameMode, viewport: Viewport, offsets: Offsets): FrameGeometry {
  if (mode === 'launcher') {
    return {
      mode,
      width: LAUNCHER_FRAME,
      height: LAUNCHER_FRAME,
      // O botão fica a `offsets` da borda; o iframe recua a folga para a sombra caber.
      right: Math.max(0, offsets.right - LAUNCHER_INSET),
      bottom: Math.max(0, offsets.bottom - LAUNCHER_INSET),
      fullscreen: false,
    };
  }
  if (viewport.width <= MOBILE_MAX_WIDTH) {
    return { mode, width: viewport.width, height: viewport.height, right: 0, bottom: 0, fullscreen: true };
  }
  const right = Math.max(PANEL_MARGIN, offsets.right);
  const bottom = Math.max(PANEL_MARGIN, offsets.bottom);
  return {
    mode,
    width: Math.max(MIN_PANEL, Math.min(PANEL_WIDTH, viewport.width - right - PANEL_MARGIN)),
    height: Math.max(MIN_PANEL, Math.min(PANEL_HEIGHT, viewport.height - bottom - PANEL_MARGIN)),
    right,
    bottom,
    fullscreen: false,
  };
}

/** Propriedades CSS do iframe (aplicadas com `!important` pelo loader). */
export function frameStyle(geometry: FrameGeometry): Record<string, string> {
  if (geometry.fullscreen) {
    return {
      top: '0',
      left: '0',
      right: '0',
      bottom: '0',
      width: '100vw',
      height: '100dvh',
      'max-width': '100vw',
      'max-height': '100dvh',
      'border-radius': '0',
      'box-shadow': 'none',
    };
  }
  const panel = geometry.mode === 'panel';
  return {
    top: 'auto',
    left: 'auto',
    right: `${geometry.right}px`,
    bottom: `${geometry.bottom}px`,
    width: `${geometry.width}px`,
    height: `${geometry.height}px`,
    'max-width': '100vw',
    'max-height': '100dvh',
    'border-radius': panel ? '16px' : '0',
    'box-shadow': panel ? '0 18px 50px -12px rgba(17, 35, 73, 0.45), 0 2px 6px rgba(17, 35, 73, 0.12)' : 'none',
  };
}

/** Lê um deslocamento em px (aceita "80", "80px" e "5rem"). Valores inválidos ou negativos viram o padrão. */
export function parseOffset(value: string | null | undefined, fallback: number): number {
  if (value === null || value === undefined) return fallback;
  const match = /^\s*(-?\d+(?:\.\d+)?)\s*(px|rem)?\s*$/.exec(value);
  if (!match) return fallback;
  const amount = Number(match[1]) * (match[2] === 'rem' ? 16 : 1);
  return Number.isFinite(amount) && amount >= 0 ? Math.round(amount) : fallback;
}

/** Deslocamento efetivo: base do `data-offset-*` mais o que o site reservar por variáveis CSS (ex.: banner de cookies). */
export function effectiveOffset(base: number, ...reserved: number[]): number {
  return base + reserved.reduce((sum, value) => sum + value, 0);
}

/** Estado do iframe a partir dos eventos do widget (`open`/`close`); `resize` legado só vale sem eles. */
export function modeFromMessage(
  data: { type?: string; width?: number; height?: number },
  current: FrameMode,
  sawModeEvent: boolean,
): { mode: FrameMode; sawModeEvent: boolean } {
  if (data.type === 'open') return { mode: 'panel', sawModeEvent: true };
  if (data.type === 'close') return { mode: 'launcher', sawModeEvent: true };
  if (data.type === 'resize' && !sawModeEvent && Number.isFinite(data.width) && Number.isFinite(data.height)) {
    return { mode: Number(data.width) > 120 || Number(data.height) > 120 ? 'panel' : 'launcher', sawModeEvent };
  }
  return { mode: current, sawModeEvent };
}
