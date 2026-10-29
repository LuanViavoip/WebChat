/** Snippet de instalação do widget. Usa só a origem do console e o id público do site: nada de tokens. */
export function widgetScript(origin: string, publicId: string): string {
  return `<script async src="${origin}/widget.js" data-widget-id="${publicId}"></script>`;
}
