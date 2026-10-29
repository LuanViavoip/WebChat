export type DeskLayout = 'wide' | 'medium' | 'narrow';

/**
 * Layout da central a partir da largura da própria área de conteúdo (viewport menos a sidebar):
 * 3 colunas; lista + conversa com detalhes em gaveta; ou lista e conversa em telas separadas.
 */
export function deskLayout(contentWidth: number): DeskLayout {
  if (contentWidth >= 960) return 'wide';
  if (contentWidth >= 680) return 'medium';
  return 'narrow';
}
