import type { ShellSlots } from './slots';

// Onda 0b devolve tudo vazio; a Gemini preenche na Onda 1.
export function createShellSlots(): ShellSlots {
  return {
    views: [],
    overlays: [],
    menuItems: [],
    messageRenderers: {},
  };
}
