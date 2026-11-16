type MediaQueryListStub = {
  matches: boolean;
  media: string;
  onchange: null;
  addListener(): void;
  removeListener(): void;
  addEventListener(): void;
  removeEventListener(): void;
  dispatchEvent(): boolean;
};

export function stubMatchMedia(matchesFor: (query: string) => boolean): void {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: (query: string): MediaQueryListStub => ({
      matches: matchesFor(query),
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

export function stubDesktopMatchMedia(): void {
  stubMatchMedia(() => false);
}

export function stubMobileMatchMedia(): void {
  stubMatchMedia((query) => query.includes('max-width: 900px'));
}
