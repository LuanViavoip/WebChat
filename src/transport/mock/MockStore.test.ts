import { LocalStorageMockStore, MemoryMockStore, MOCK_STORE_KEY, type MockStore } from './MockStore';
import { createSeedState } from './seed';
import { toPersisted, type PersistedState } from './state';

const sample = (): PersistedState => toPersisted(createSeedState('2026-11-13T12:00:00.000Z'));

function contract(name: string, make: () => MockStore) {
  describe(name, () => {
    it('começa vazio', () => {
      expect(make().load()).toBeUndefined();
    });

    it('salva e carrega o mesmo estado', () => {
      const store = make();
      expect(store.save(sample())).toBe(true);
      expect(store.load()).toEqual(sample());
    });

    it('quem carrega recebe uma cópia: mexer nela não altera o que está salvo', () => {
      const store = make();
      store.save(sample());
      const loaded = store.load();
      if (!loaded) {
        throw new Error('esperava estado');
      }
      loaded.tenants.length = 0;
      expect(store.load()?.tenants).toHaveLength(2);
    });

    it('clear esquece o estado', () => {
      const store = make();
      store.save(sample());
      store.clear();
      expect(store.load()).toBeUndefined();
    });
  });
}

contract('MemoryMockStore', () => new MemoryMockStore());

describe('LocalStorageMockStore (jsdom)', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  contract('contrato', () => new LocalStorageMockStore());

  it('usa a chave sm-webchat-mock-v2', () => {
    new LocalStorageMockStore().save(sample());
    expect(MOCK_STORE_KEY).toBe('sm-webchat-mock-v2');
    expect(window.localStorage.getItem('sm-webchat-mock-v2')).not.toBeNull();
  });

  it('JSON corrompido no storage vira "sem estado" (não lança)', () => {
    window.localStorage.setItem(MOCK_STORE_KEY, '{nao é json');
    expect(new LocalStorageMockStore().load()).toBeUndefined();
  });

  it('storage que lança não derruba o mock', () => {
    const broken = {
      getItem: () => {
        throw new Error('bloqueado');
      },
      setItem: () => {
        throw new Error('cheio');
      },
      removeItem: () => {
        throw new Error('bloqueado');
      },
    };
    const store = new LocalStorageMockStore(broken);
    expect(store.load()).toBeUndefined();
    expect(store.save(sample())).toBe(false);
    expect(() => {
      store.clear();
    }).not.toThrow();
  });

  it('duas instâncias sobre o mesmo storage enxergam o mesmo estado (como duas abas)', () => {
    const a = new LocalStorageMockStore();
    const b = new LocalStorageMockStore();
    a.save(sample());
    expect(b.load()).toEqual(sample());
  });
});
