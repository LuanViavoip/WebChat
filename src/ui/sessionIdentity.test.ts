import { BV_USERS, ICS_TENANT_ID, BV_TENANT_ID, ICS_USERS } from '../transport/mock/seed';
import {
  identityForUser,
  initialIdentity,
  loginGroups,
  readStoredIdentity,
  SESSION_STORAGE_KEY,
  storeIdentity,
  stripAsParam,
} from './sessionIdentity';

afterEach(() => {
  window.sessionStorage.clear();
  window.history.replaceState(null, '', '/');
});

describe('loginGroups', () => {
  it('agrupa por empresa, com admin, supervisores e agentes, e só usuários ativos', () => {
    const groups = loginGroups();
    expect(groups.map((group) => group.tenant.name)).toEqual(['ICS Saúde', 'Clínica Boa Vista']);
    expect(groups[0]?.users.map((user) => user.role)).toEqual([
      'admin',
      'supervisor',
      'supervisor',
      'agent',
      'agent',
      'agent',
      'agent',
      'agent',
      'agent',
    ]);
    expect(groups[1]?.users.map((user) => user.id)).toEqual(Object.values(BV_USERS));
    for (const group of groups) {
      expect(group.users.every((user) => user.active && user.tenantId === group.tenant.id)).toBe(true);
    }
  });
});

describe('identityForUser', () => {
  it('o tenant vem do usuário', () => {
    expect(identityForUser(ICS_USERS.bruno)).toEqual({ tenantId: ICS_TENANT_ID, userId: ICS_USERS.bruno });
    expect(identityForUser(BV_USERS.paula)).toEqual({ tenantId: BV_TENANT_ID, userId: BV_USERS.paula });
  });

  it('id desconhecido não entra', () => {
    expect(identityForUser('ninguem')).toBeUndefined();
    expect(identityForUser('')).toBeUndefined();
  });
});

describe('sessão da aba', () => {
  it('guarda o usuário no sessionStorage e lê de volta', () => {
    const identity = identityForUser(ICS_USERS.ana);
    if (!identity) {
      throw new Error('seed');
    }
    storeIdentity(identity);
    expect(window.sessionStorage.getItem(SESSION_STORAGE_KEY)).toBe(ICS_USERS.ana);
    expect(readStoredIdentity()).toEqual(identity);
  });

  it('valor inválido no storage é ignorado', () => {
    window.sessionStorage.setItem(SESSION_STORAGE_KEY, 'lixo');
    expect(readStoredIdentity()).toBeUndefined();
  });
});

describe('initialIdentity', () => {
  it('?como= válido entra direto e grava a sessão', () => {
    expect(initialIdentity('?como=bv-paula')).toEqual({ tenantId: BV_TENANT_ID, userId: BV_USERS.paula });
    expect(window.sessionStorage.getItem(SESSION_STORAGE_KEY)).toBe('bv-paula');
  });

  it('?como= inválido mostra Entrar como e limpa a sessão anterior', () => {
    window.sessionStorage.setItem(SESSION_STORAGE_KEY, ICS_USERS.ana);
    expect(initialIdentity('?como=xyz')).toBeUndefined();
    expect(window.sessionStorage.getItem(SESSION_STORAGE_KEY)).toBeNull();
  });

  it('sem ?como= vale a sessão da aba', () => {
    expect(initialIdentity('')).toBeUndefined();
    window.sessionStorage.setItem(SESSION_STORAGE_KEY, ICS_USERS.ana);
    expect(initialIdentity('?falha=upload')?.userId).toBe(ICS_USERS.ana);
  });

  it('?como= vence a sessão guardada', () => {
    window.sessionStorage.setItem(SESSION_STORAGE_KEY, ICS_USERS.ana);
    expect(initialIdentity('?como=ics-bruno')?.userId).toBe(ICS_USERS.bruno);
  });
});

describe('stripAsParam', () => {
  it('remove só o como e preserva os demais parâmetros', () => {
    window.history.replaceState(null, '', '/?como=ics-bruno&falha=upload');
    stripAsParam();
    expect(window.location.search).toBe('?falha=upload');
  });
});
