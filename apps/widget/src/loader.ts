(() => {
  const script = document.currentScript;
  if (!(script instanceof HTMLScriptElement)) return;
  const site = script.dataset.widgetId || script.dataset.site;
  if (!site) return;
  const host = window as Window & { __viavoipWebchat?: true };
  if (host.__viavoipWebchat) return;
  host.__viavoipWebchat = true;
  const origin = new URL(script.src).origin;
  const iframe = document.createElement('iframe');
  iframe.src = `${origin}/widget/?site=${encodeURIComponent(site)}`;
  iframe.title = 'Webchat ViaVoip';
  iframe.setAttribute('data-viavoip-webchat', site);
  iframe.style.cssText = [
    'position:fixed',
    'bottom:16px',
    'right:16px',
    'width:72px',
    'height:72px',
    'border:0',
    'border-radius:16px',
    'z-index:2147483000',
    'background:transparent',
    'color-scheme:normal',
    'max-width:100vw',
    'max-height:100dvh',
  ].join(';');
  const mount = () => {
    if (document.querySelector('iframe[data-viavoip-webchat]')) return;
    document.body.appendChild(iframe);
  };
  if (document.body) mount();
  else document.addEventListener('DOMContentLoaded', mount);
  window.addEventListener('message', (event: MessageEvent) => {
    if (event.origin !== origin || event.source !== iframe.contentWindow) return;
    const data = event.data as { source?: string; type?: string; width?: number; height?: number } | null;
    if (!data || data.source !== 'viavoip-webchat' || data.type !== 'resize') return;
    if (!Number.isFinite(data.width) || !Number.isFinite(data.height)) return;
    const width = Math.min(Math.max(Math.round(Number(data.width)), 64), 480);
    const height = Math.min(Math.max(Math.round(Number(data.height)), 64), 720);
    const expanded = width > 120 || height > 120;
    iframe.style.width = `${width}px`;
    iframe.style.height = `${height}px`;
    iframe.style.right = expanded ? '0' : '16px';
    iframe.style.bottom = expanded ? '0' : '16px';
    iframe.style.borderRadius = expanded ? '0' : '16px';
  });
})();
