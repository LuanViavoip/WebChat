import { MockBackend } from './MockBackend';
import { LocalStorageMockStore, MOCK_STORE_KEY, type MockStore } from './MockStore';
import { createSeedState, ICS_TENANT_ID, ICS_USERS } from './seed';
import { fromPersisted, PERSIST_VERSION, toPersisted, type PersistedState } from './state';

// Migração do formato 1:1 (agente.ilhaId, ilha.supervisorId) para o N:N (plano da fusão, C2): schema v5.
type Json = Record<string, any>;
const fresh = (): Json => JSON.parse(JSON.stringify(toPersisted(createSeedState('2026-11-13T12:00:00.000Z')))) as Json;
const ics = (s: Json): Json => s.tenants.find((t: Json) => t.tenant.id === ICS_TENANT_ID) as Json;

/** Reescreve o estado como a v4 gravava: um `ilhaId` por agente e um `supervisorId` por ilha. */
function asV4(): Json {
  const s = fresh();
  s.version = 4;
  for (const t of s.tenants as Json[]) {
    for (const u of Object.values<Json>(t.directory.users as Record<string, Json>)) {
      if (u.role === 'agent') {
        u.ilhaId = u.ilhaIds[0];
        delete u.ilhaIds;
      }
    }
    for (const i of Object.values<Json>(t.directory.ilhas as Record<string, Json>)) {
      i.supervisorId = i.supervisorIds[0];
      delete i.supervisorIds;
    }
  }
  return s;
}
const rawStore = (raw: unknown): MockStore => ({ load: () => JSON.parse(JSON.stringify(raw)) as PersistedState, save: () => true, clear: () => undefined });

describe('migração 1:1 -> N:N do localStorage do mock', () => {
  it('versão atual é a 5', () => {
    expect(PERSIST_VERSION).toBe(5);
  });

  it('v4 (ilhaId/supervisorId) carrega migrada, válida, sem perder mensagens', () => {
    const state = fromPersisted(asV4());
    const d = state?.get(ICS_TENANT_ID)?.directory;
    expect(d).toBeDefined();
    const ana = d?.users[ICS_USERS.ana];
    expect(ana?.role === 'agent' && ana.ilhaIds).toEqual(['ics-norte']);
    expect(d?.ilhas['ics-norte' as never]?.supervisorIds).toEqual([ICS_USERS.carla]);
    expect(Object.values(state?.get(ICS_TENANT_ID)?.messages ?? {}).flat().length).toBeGreaterThan(0);
  });

  it('v4 pelo backend: carrega e a próxima gravação sai na v5', () => {
    const backend = new MockBackend({ store: rawStore(asV4()), now: () => '2026-11-16T12:00:00.000Z' });
    expect(backend.server.toPersisted().version).toBe(5);
    expect(Object.keys(backend.server.getState().get(ICS_TENANT_ID)?.directory.users ?? {})).toHaveLength(9);
    backend.close();
  });

  it('v5 ainda no formato antigo (ilhaId, supervisorId) é descartado', () => {
    const a = asV4();
    a.version = 5;
    expect(fromPersisted(a)).toBeUndefined();
  });

  const tamper: Array<[string, (s: Json) => void]> = [
    ['agente sem nenhuma ilha', (s) => { ics(s).directory.users[ICS_USERS.ana].ilhaIds = []; }],
    ['agente com ilha repetida', (s) => { ics(s).directory.users[ICS_USERS.ana].ilhaIds = ['ics-norte', 'ics-norte']; }],
    ['agente com ilha inexistente', (s) => { ics(s).directory.users[ICS_USERS.ana].ilhaIds = ['ics-norte', 'fantasma']; }],
    ['ilha com agente e sem supervisor', (s) => { ics(s).directory.ilhas['ics-norte'].supervisorIds = []; }],
    ['ilha com supervisor desconhecido', (s) => { ics(s).directory.ilhas['ics-plantao'].supervisorIds = [ICS_USERS.carla, 'fantasma']; }],
    ['ilha com supervisorIds que não é lista', (s) => { ics(s).directory.ilhas['ics-sul'].supervisorIds = ICS_USERS.carla; }],
  ];
  it.each(tamper)('v5 adulterado é descartado: %s', (_n, f) => {
    const s = fresh();
    f(s);
    expect(fromPersisted(s)).toBeUndefined();
  });

  const group = (extra: Json): Json => ({ kind: 'group', id: 'grp:1', tenantId: 'ics', title: 'G', members: [ICS_USERS.carla], createdAt: '2026-11-10T12:00:00.000Z', ...extra });
  const withGroup = (s: Json, g: Json): Json => {
    ics(s).conversations['grp:1'] = g;
    ics(s).createdAt['grp:1'] = g.createdAt;
    return s;
  };
  it('grupo no formato antigo vira origin custom (o mais conservador: edição manual como grupo do usuário)', () => {
    const s = asV4();
    withGroup(s, group({ createdBy: ICS_USERS.carla, ilhaId: null }));
    const g = fromPersisted(s)?.get(ICS_TENANT_ID)?.conversations['grp:1' as never];
    expect(g?.kind === 'group' && g.origin).toEqual({ kind: 'custom', createdBy: ICS_USERS.carla });
  });
  it('v5: grupo com origin válida carrega; sem origin, origem ilha inexistente ou criador desconhecido é descartado', () => {
    expect(fromPersisted(withGroup(fresh(), group({ origin: { kind: 'ilha', ilhaId: 'ics-sul' } })))).toBeDefined();
    expect(fromPersisted(withGroup(fresh(), group({ origin: { kind: 'custom', createdBy: ICS_USERS.carla } })))).toBeDefined();
    expect(fromPersisted(withGroup(fresh(), group({})))).toBeUndefined();
    expect(fromPersisted(withGroup(fresh(), group({ origin: { kind: 'ilha', ilhaId: 'fantasma' } })))).toBeUndefined();
    expect(fromPersisted(withGroup(fresh(), group({ origin: { kind: 'custom', createdBy: 'fantasma' } })))).toBeUndefined();
  });

  it.each([['null', null], ['array vazio', []], ['número', 42], ['string', 'x'], ['só a versão', { version: 5 }], ['tenants não é lista', { version: 5, tenants: {} }], ['versão 4 sem tenants', { version: 4 }], ['tenant nulo', { version: 5, tenants: [null] }]])(
    'raiz estranha (%s) é descartada sem exceção',
    (_n, raw) => {
      expect(() => fromPersisted(raw)).not.toThrow();
      expect(fromPersisted(raw)).toBeUndefined();
    },
  );

  it('o backend com storage estranho (inclusive JSON inválido no localStorage) recria a seed sem exceção', () => {
    for (const raw of [null, [], 42, 'x', { version: 5 }]) {
      const backend = new MockBackend({ store: rawStore(raw), now: () => '2026-11-16T12:00:00.000Z' });
      expect(Object.keys(backend.server.getState().get(ICS_TENANT_ID)?.directory.users ?? {})).toHaveLength(9);
      backend.close();
    }
    const storage = new Map<string, string>([[MOCK_STORE_KEY, '{nao-json']]);
    const store = new LocalStorageMockStore({
      getItem: (k: string) => storage.get(k) ?? null,
      setItem: (k: string, v: string) => void storage.set(k, v),
      removeItem: (k: string) => void storage.delete(k),
    });
    const backend = new MockBackend({ store });
    expect(backend.server.getState().get(ICS_TENANT_ID)).toBeDefined();
    backend.close();
  });
});
