import type { StaffUser } from '@viavoip/internal-domain';
import type { Tenant } from '@viavoip/internal-domain';
import type { ConnectRequest, LoginGroup } from '../transport/ChatTransport';

/** Chave do `sessionStorage`: a sessão é por aba e sobrevive ao reload dela. */
export const SESSION_STORAGE_KEY = 'sm-webchat:sessao';
/** Parâmetro da URL que entra direto como um usuário cadastrado. */
export const AS_PARAM = 'como';

export type { LoginGroup };
export type ActiveLoginGroup = { tenant: Tenant; users: StaffUser[] };

/**
 * Os usuários ATIVOS por empresa, na ordem do diretório do servidor (que já inclui os recém-cadastrados).
 * Decisão: desativado não aparece na lista (não há como "entrar como" quem não pode entrar).
 */
export function loginGroups(groups: readonly LoginGroup[]): ActiveLoginGroup[] {
  return groups.map(({ tenant, users }) => ({ tenant, users: users.filter((user) => user.active) }));
}

/**
 * O tenant vem do usuário: id desconhecido = `undefined`. Desativado ainda resolve, de propósito: o `connect`
 * é quem recusa, com a mensagem clara (um `?como=` ou uma sessão de aba de quem foi desativado).
 */
export function identityForUser(groups: readonly LoginGroup[], userId: string): ConnectRequest | undefined {
  for (const { tenant, users } of groups) {
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

export function readStoredIdentity(groups: readonly LoginGroup[]): ConnectRequest | undefined {
  try {
    const raw = safeStorage()?.getItem(SESSION_STORAGE_KEY);
    return raw ? identityForUser(groups, raw) : undefined;
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
export function initialIdentity(groups: readonly LoginGroup[], search: string): ConnectRequest | undefined {
  const asParam = new URLSearchParams(search).get(AS_PARAM);
  if (asParam !== null) {
    const identity = identityForUser(groups, asParam);
    if (identity) {
      storeIdentity(identity);
    } else {
      clearStoredIdentity();
    }
    return identity;
  }
  return readStoredIdentity(groups);
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
