import { LAUNCHER_FRAME, PANEL_HEIGHT, PANEL_WIDTH } from './frame-geometry.js';

/**
 * Tamanho nominal informado ao site em `resize` (compatibilidade com loaders antigos).
 * O loader atual ignora esses números e calcula a geometria pelo viewport do site.
 */
export function panelSize(open: boolean): { width: number; height: number } {
  if (!open) return { width: LAUNCHER_FRAME, height: LAUNCHER_FRAME };
  return { width: PANEL_WIDTH, height: PANEL_HEIGHT };
}
