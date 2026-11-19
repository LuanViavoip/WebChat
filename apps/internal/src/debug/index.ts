import type { ChatTransport } from '../transport/ChatTransport';

export const DEBUG_STORAGE_KEY = 'viavoip.chat.debug';

export type DebugSource = 'query' | 'session' | 'local' | 'off';

export type DebugFlags = {
  readonly enabled: boolean;
  readonly source: DebugSource;
};

export type DebugStorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

function safeGet(storage: DebugStorageLike | null | undefined, key: string): string | null {
  if (!storage) {
    return null;
  }
  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
}

function safeSet(storage: DebugStorageLike | null | undefined, key: string, value: string): void {
  if (!storage) {
    return;
  }
  try {
    storage.setItem(key, value);
  } catch {
    // Armazenamento indisponível (aba privada / sandbox) — ignora sem quebrar o chat.
  }
}

function safeRemove(storage: DebugStorageLike | null | undefined, key: string): void {
  if (!storage) {
    return;
  }
  try {
    storage.removeItem(key);
  } catch {
    // Armazenamento indisponível — ignora sem quebrar o chat.
  }
}

export function readDebugFlags(
  search: string,
  storage?: DebugStorageLike | null,
  localStorageRef?: DebugStorageLike | null,
): DebugFlags {
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  const query = params.get('debug');

  if (query === '1') {
    safeSet(storage, DEBUG_STORAGE_KEY, '1');
    return { enabled: true, source: 'query' };
  }

  if (query === '0') {
    safeRemove(storage, DEBUG_STORAGE_KEY);
    safeRemove(localStorageRef, DEBUG_STORAGE_KEY);
    return { enabled: false, source: 'off' };
  }

  if (safeGet(storage, DEBUG_STORAGE_KEY) === '1') {
    return { enabled: true, source: 'session' };
  }

  if (safeGet(localStorageRef, DEBUG_STORAGE_KEY) === '1') {
    return { enabled: true, source: 'local' };
  }

  return { enabled: false, source: 'off' };
}

// Stub da Onda 0b (spec B.13 e C.1): devolve o mesmo objeto sem Proxy nem buffer.
export function wrapTransportForDebug(transport: ChatTransport, flags: DebugFlags): ChatTransport {
  if (flags.enabled) {
    return transport;
  }
  return transport;
}

// Stub da Onda 0b (spec C.1 e C.2): no-op sem alocação enquanto o módulo de debug não entra.
export const debugAction: (name: string, detail?: unknown) => void = () => {};
