import type { StaffUser } from '../domain/identity';
import type { Tenant } from '../domain/tenant';
import type { ConnectRequest } from '../transport/ChatTransport';
import { BV_TENANT, bvDirectory, ICS_TENANT, icsDirectory } from '../transport/mock/seed';

/** Chave do `sessionStorage`: a sessão é por aba e sobrevive ao reload dela. */
export const SESSION_STORAGE_KEY = 'sm-webchat:sessao';
/** Parâmetro da URL que entra direto como um usuário da seed. */
export const AS_PARAM = 'como';

export type LoginGroup = { tenant: Tenant; users: StaffUser[] };

/** Os usuários ativos da seed, agrupados por empresa (admin, supervisores, agentes: a ordem do diretório). */
export function loginGroups(): LoginGroup[] {
  return [
    { tenant: ICS_TENANT, directory: icsDirectory() },
    { tenant: BV_TENANT, directory: bvDirectory() },
  ].map(({ tenant, directory }) => ({
    tenant,
    users: Object.values(directory.users).filter((user) => user.active),
  }));
}

/** O tenant vem do usuário: id desconhecido ou inativo = `undefined`. */
export function identityForUser(userId: string): ConnectRequest | undefined {
  for (const { tenant, users } of loginGroups()) {
    const found = users.find((user) => user.id === userId);
    if (found) {
      return { tenantId: tenant.id, userId: found.id };
    }
  }
  return undefined;
}

function safeStorage(): Storage | undefined {
  try {
    return window.sessionStorage;
  } catch {
    return undefined;
  }
}

export function readStoredIdentity(): ConnectRequest | undefined {
  try {
    const raw = safeStorage()?.getItem(SESSION_STORAGE_KEY);
    return raw ? identityForUser(raw) : undefined;
  } catch {
    return undefined;
  }
}

export function storeIdentity(identity: ConnectRequest): void {
  try {
    safeStorage()?.setItem(SESSION_STORAGE_KEY, identity.userId);
  } catch {
    // Sem storage (modo restrito): a sessão vale só até recarregar.
  }
}

export function clearStoredIdentity(): void {
  try {
    safeStorage()?.removeItem(SESSION_STORAGE_KEY);
  } catch {
    // idem
  }
}

/** `?como=` tem precedência (id inválido = Entrar como); sem ele vale a sessão da aba. */
export function initialIdentity(search: string): ConnectRequest | undefined {
  const asParam = new URLSearchParams(search).get(AS_PARAM);
  if (asParam !== null) {
    const identity = identityForUser(asParam);
    if (identity) {
      storeIdentity(identity);
    } else {
      clearStoredIdentity();
    }
    return identity;
  }
  return readStoredIdentity();
}

/** Tira `?como=` da URL (senão o reload voltaria ao usuário que acabou de sair). */
export function stripAsParam(): void {
  const url = new URL(window.location.href);
  if (!url.searchParams.has(AS_PARAM)) {
    return;
  }
  url.searchParams.delete(AS_PARAM);
  window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
}
