import {
  DEFAULT_OFFSET,
  effectiveOffset,
  frameGeometry,
  frameStyle,
  modeFromMessage,
  parseOffset,
  type FrameMode,
} from './frame-geometry.js';

// Constantes de packages/protocol/src/post-message.ts, repetidas aqui para o loader não carregar o zod.
const WIDGET_SOURCE = 'viavoip-webchat';
const PARENT_SOURCE = 'viavoip-webchat-parent';

type ViaVoipWebchatApi = { open: () => void; close: () => void };
type HostWindow = Window & { __viavoipWebchat?: true; ViaVoipWebchat?: ViaVoipWebchatApi };

(() => {
  const script = document.currentScript;
  if (!(script instanceof HTMLScriptElement)) return;
  const site = script.dataset.widgetId || script.dataset.site;
  if (!site) return;
  const host = window as HostWindow;
  if (host.__viavoipWebchat) return;
  host.__viavoipWebchat = true;

  const origin = new URL(script.src).origin;
  const iframe = document.createElement('iframe');
  iframe.src = `${origin}/widget/?site=${encodeURIComponent(site)}`;
  iframe.title = 'Webchat ViaVoip';
  iframe.setAttribute('data-viavoip-webchat', site);

  // Estilos fixos e dinâmicos entram como inline !important para o CSS do site não sobrescrever.
  const setStyles = (styles: Record<string, string>) => {
    for (const [property, value] of Object.entries(styles)) iframe.style.setProperty(property, value, 'important');
  };
  setStyles({
    position: 'fixed',
    border: '0',
    margin: '0',
    padding: '0',
    background: 'transparent',
    'color-scheme': 'normal',
    'z-index': '2147483000',
    overflow: 'hidden',
  });

  let mode: FrameMode = 'launcher';
  let sawModeEvent = false;
  let ready = false;
  let pending: 'open' | 'close' | null = null;

  const baseBottom = parseOffset(script.dataset.offsetBottom, DEFAULT_OFFSET);
  const baseRight = parseOffset(script.dataset.offsetRight, DEFAULT_OFFSET);

  /** Variável CSS do site em px (ex.: altura do banner de cookies). Ausente conta como 0. */
  const cssPixels = (name: string | undefined): number => {
    if (!name || !/^--[\w-]+$/.test(name)) return 0;
    return parseOffset(getComputedStyle(document.documentElement).getPropertyValue(name), 0);
  };

  const apply = () => {
    const viewport = { width: window.innerWidth, height: window.innerHeight };
    const offsets = {
      bottom: effectiveOffset(baseBottom, cssPixels(script.dataset.offsetBottomVar), cssPixels('--viavoip-webchat-bottom')),
      right: effectiveOffset(baseRight, cssPixels(script.dataset.offsetRightVar), cssPixels('--viavoip-webchat-right')),
    };
    setStyles(frameStyle(frameGeometry(mode, viewport, offsets)));
  };

  let frame = 0;
  const schedule = () => {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      apply();
    });
  };

  const send = (type: 'open' | 'close') => {
    const target = iframe.contentWindow;
    if (!target || !ready) {
      pending = type;
      return;
    }
    target.postMessage({ source: PARENT_SOURCE, type }, origin);
  };

  host.ViaVoipWebchat = host.ViaVoipWebchat ?? { open: () => send('open'), close: () => send('close') };

  apply();
  const mount = () => {
    if (document.querySelector('iframe[data-viavoip-webchat]')) return;
    document.body.appendChild(iframe);
  };
  if (document.body) mount();
  else document.addEventListener('DOMContentLoaded', mount);

  window.addEventListener('message', (event: MessageEvent) => {
    if (event.origin !== origin || event.source !== iframe.contentWindow) return;
    const data = event.data as { source?: string; type?: string; width?: number; height?: number } | null;
    if (!data || data.source !== WIDGET_SOURCE) return;
    if (data.type === 'ready') {
      ready = true;
      if (pending) {
        const next = pending;
        pending = null;
        send(next);
      }
      return;
    }
    const next = modeFromMessage(data, mode, sawModeEvent);
    mode = next.mode;
    sawModeEvent = next.sawModeEvent;
    apply();
  });

  // Recalcula quando o viewport do site muda (janela, rotação, teclado virtual) ou quando o site muda as variáveis.
  window.addEventListener('resize', schedule);
  window.addEventListener('orientationchange', schedule);
  window.visualViewport?.addEventListener('resize', schedule);
  new MutationObserver(schedule).observe(document.documentElement, { attributes: true, attributeFilter: ['style', 'class'] });
})();
