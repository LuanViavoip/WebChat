import type { PersistedState } from './state';

/** Onde o estado serializável do servidor simulado vive entre cargas (e entre abas). */
export interface MockStore {
  /** `undefined` = nada salvo (ou ilegível): o chamador cria a seed. */
  load(): PersistedState | undefined;
  /** `false` = não conseguiu gravar (cota, storage bloqueado): o chamador passa a operar só em memória. */
  save(state: PersistedState): boolean;
  clear(): void;
}

export const MOCK_STORE_KEY = 'sm-webchat-mock-v2';

/** Guarda uma cópia serializada: quem lê nunca compartilha referência com quem gravou. */
export class MemoryMockStore implements MockStore {
  private json: string | undefined;

  load(): PersistedState | undefined {
    return this.json === undefined ? undefined : (JSON.parse(this.json) as PersistedState);
  }

  save(state: PersistedState): boolean {
    this.json = JSON.stringify(state);
    return true;
  }

  clear(): void {
    this.json = undefined;
  }
}

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export class LocalStorageMockStore implements MockStore {
  constructor(
    private readonly storage: StorageLike = window.localStorage,
    private readonly key: string = MOCK_STORE_KEY,
  ) {}

  load(): PersistedState | undefined {
    try {
      const raw = this.storage.getItem(this.key);
      return raw === null ? undefined : (JSON.parse(raw) as PersistedState);
    } catch {
      return undefined;
    }
  }

  save(state: PersistedState): boolean {
    try {
      this.storage.setItem(this.key, JSON.stringify(state));
      return true;
    } catch {
      return false;
    }
  }

  clear(): void {
    try {
      this.storage.removeItem(this.key);
    } catch {
      // Sem storage, não há o que limpar.
    }
  }
}
