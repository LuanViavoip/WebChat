import { describe, expect, it } from 'vitest';
import {
  DEBUG_STORAGE_KEY,
  debugAction,
  readDebugFlags,
  wrapTransportForDebug,
  type DebugStorageLike,
} from './index';
import { ScriptedTransport } from '../test/scriptedTransport';

function memoryStorage(initial: Record<string, string> = {}): DebugStorageLike & { dump(): Record<string, string> } {
  const map = new Map<string, string>(Object.entries(initial));
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => {
      map.set(key, value);
    },
    removeItem: (key) => {
      map.delete(key);
    },
    dump: () => Object.fromEntries(map.entries()),
  };
}

describe('debug stub (Onda 0b)', () => {
  it('desliga por padrão quando não há query nem storage', () => {
    const session = memoryStorage();
    const flags = readDebugFlags('', session);

    expect(flags).toEqual({ enabled: false, source: 'off' });
    expect(session.getItem(DEBUG_STORAGE_KEY)).toBeNull();
  });

  it('lê ?debug=1 e persiste no storage, e ?debug=0 limpa e desliga', () => {
    const session = memoryStorage();
    const local = memoryStorage({ [DEBUG_STORAGE_KEY]: '1' });

    const onFromQuery = readDebugFlags('?como=ics-ana&debug=1', session, local);
    expect(onFromQuery).toEqual({ enabled: true, source: 'query' });
    expect(session.getItem(DEBUG_STORAGE_KEY)).toBe('1');

    const persistedSession = readDebugFlags('', session, local);
    expect(persistedSession).toEqual({ enabled: true, source: 'session' });

    const offFromQuery = readDebugFlags('?debug=0', session, local);
    expect(offFromQuery).toEqual({ enabled: false, source: 'off' });
    expect(session.getItem(DEBUG_STORAGE_KEY)).toBeNull();
    expect(local.getItem(DEBUG_STORAGE_KEY)).toBeNull();
    expect(readDebugFlags('', session, local)).toEqual({ enabled: false, source: 'off' });
  });

  it('lê fallback de localStorage quando sessionStorage não tem chave', () => {
    const session = memoryStorage();
    const local = memoryStorage({ [DEBUG_STORAGE_KEY]: '1' });

    expect(readDebugFlags('', session, local)).toEqual({ enabled: true, source: 'local' });
  });

  it('wrapTransportForDebug devolve exatamente o mesmo objeto quando desligado (e no stub da 0b)', () => {
    const transport = new ScriptedTransport();
    const off = readDebugFlags('');

    expect(wrapTransportForDebug(transport, off)).toBe(transport);
    expect(wrapTransportForDebug(transport, { enabled: true, source: 'query' })).toBe(transport);
  });

  it('debugAction é no-op seguro', () => {
    expect(() => {
      debugAction('composer.send', { len: 4 });
    }).not.toThrow();
  });
});
