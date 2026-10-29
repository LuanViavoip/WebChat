import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { parseHashRoute, routeHash, type RouteSlugs } from './route.js';

export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}

/** Rota derivada de `location.hash`. A rota padrão também é gravada na URL para permitir deep link. */
export function useHashRoute<T extends string>(
  slugs: RouteSlugs<T>,
  allowed: readonly T[],
  fallback: T,
): [T, (route: T) => void] {
  const read = useCallback(
    () => parseHashRoute(window.location.hash, slugs, allowed, fallback),
    [slugs, allowed, fallback],
  );
  const [route, setRoute] = useState<T>(read);

  useEffect(() => {
    const sync = () => setRoute(read());
    const current = read();
    if (window.location.hash !== routeHash(current, slugs)) {
      window.history.replaceState(null, '', routeHash(current, slugs));
    }
    sync();
    window.addEventListener('hashchange', sync);
    return () => window.removeEventListener('hashchange', sync);
  }, [read, slugs]);

  const navigate = useCallback(
    (next: T) => {
      if (window.location.hash === routeHash(next, slugs)) setRoute(next);
      else window.location.hash = routeHash(next, slugs);
    },
    [slugs],
  );
  return [route, navigate];
}

/** Largura do elemento (0 enquanto estiver oculto). */
export function useElementWidth(ref: RefObject<HTMLElement | null>): number {
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) setWidth(Math.round(entry.contentRect.width));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);
  return width;
}

/** Estado persistido em localStorage, tolerante a armazenamento bloqueado. */
export function useStoredFlag(key: string, initial: boolean): [boolean, (value: boolean) => void] {
  const [value, setValue] = useState<boolean>(() => {
    try {
      const stored = window.localStorage.getItem(key);
      return stored === null ? initial : stored === '1';
    } catch {
      return initial;
    }
  });
  const keyRef = useRef(key);
  const update = useCallback((next: boolean) => {
    setValue(next);
    try {
      window.localStorage.setItem(keyRef.current, next ? '1' : '0');
    } catch {
      /* armazenamento indisponível: o estado vale só para esta sessão */
    }
  }, []);
  return [value, update];
}
