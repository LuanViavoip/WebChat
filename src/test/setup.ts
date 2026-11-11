import '@testing-library/jest-dom/vitest';

beforeEach(() => {
  window.history.replaceState(null, '');
});

if (typeof URL.createObjectURL !== 'function') {
  const blobs = new Map<string, Blob>();
  let seq = 0;
  URL.createObjectURL = (blob: Blob) => {
    seq += 1;
    const url = `blob:test/${String(seq)}`;
    blobs.set(url, blob);
    return url;
  };
  URL.revokeObjectURL = (url: string) => {
    blobs.delete(url);
  };
}

if (typeof HTMLDialogElement !== 'undefined') {
  const proto = HTMLDialogElement.prototype;
  if (typeof proto.showModal !== 'function') {
    proto.showModal = function showModal() {
      this.setAttribute('open', '');
    };
  }
  if (typeof proto.close !== 'function') {
    proto.close = function close() {
      this.removeAttribute('open');
      this.dispatchEvent(new Event('close'));
    };
  }
}

if (typeof window.matchMedia !== 'function') {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener() {},
      removeListener() {},
      addEventListener() {},
      removeEventListener() {},
      dispatchEvent() {
        return false;
      },
    }),
  });
}
