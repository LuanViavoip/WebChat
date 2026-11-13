import type { StaffRole, StaffUser } from './identity';
import { err, ok, type Result } from './result';
import type { TenantId } from './tenant';

export const CAPABILITIES = [
  'chat.use', // participar do chat (diretas, grupos)
  'group.manage', // criar/editar os próprios grupos
  'announcement.publish', // publicar/editar/expirar os próprios avisos
  'announcement.receipts', // ver quem viu/deu ciência nos próprios avisos
  'announcement.moderate', // moderar comentários dos próprios avisos
  'agents.manage', // cadastrar/mover/desativar agentes
  'ilhas.manage', // criar/renomear ilhas, atribuir supervisor
  'supervisors.manage', // cadastrar/desativar supervisores
  'grants.manage', // conceder/revogar capacidades (sujeito a canGrant)
  'admin.console', // ver a aba Administração
] as const;

export type Capability = (typeof CAPABILITIES)[number];
export type Grants = ReadonlySet<Capability>;

/** Teto: o máximo que a role pode ter. Grants sempre ⊆ teto. */
export const ROLE_CEILING: Readonly<Record<StaffRole, Grants>> = {
  admin: new Set<Capability>(CAPABILITIES),
  supervisor: new Set<Capability>([
    'chat.use',
    'group.manage',
    'announcement.publish',
    'announcement.receipts',
    'announcement.moderate',
    // Decisão do Luan: o supervisor cadastra agentes e mexe nas permissões deles.
    'agents.manage',
    'grants.manage',
  ]),
  agent: new Set<Capability>(['chat.use']),
};

/** Padrão ao cadastrar. Decisão do Luan: o admin usa o chat, então o padrão dele é o teto inteiro (inclui chat.use). */
export const ROLE_DEFAULT: Readonly<Record<StaffRole, Grants>> = {
  admin: new Set<Capability>(CAPABILITIES),
  supervisor: new Set<Capability>(ROLE_CEILING.supervisor),
  agent: new Set<Capability>(['chat.use']),
};

/** Posse efetiva: grants ∩ teto da role. Grant fora do teto (dado corrompido) nunca vale. */
export function effectiveGrants(user: StaffUser): Grants {
  return new Set([...user.grants].filter((capability) => ROLE_CEILING[user.role].has(capability)));
}

export const ROLE_RANK: Readonly<Record<StaffRole, number>> = { admin: 3, supervisor: 2, agent: 1 };

export type GrantDenial =
  | 'cross-tenant'
  | 'self'
  | 'actor-inactive'
  | 'no-grants-manage'
  | 'actor-lacks-capability' // ninguém concede o que não tem
  | 'above-target-ceiling' // capacidade fora do teto da role do alvo
  | 'not-higher-rank'; // só concede para role estritamente abaixo

/** Regras em ordem (§2.7): tenant, self, ator ativo + grants.manage, posse, teto do alvo, hierarquia. */
export function canGrant(actor: StaffUser, target: StaffUser, capability: Capability): Result<true, GrantDenial> {
  const common = commonGrantChecks(actor, target, capability);
  if (common) {
    return err(common);
  }
  if (!ROLE_CEILING[target.role].has(capability)) {
    return err('above-target-ceiling');
  }
  if (ROLE_RANK[actor.role] <= ROLE_RANK[target.role]) {
    return err('not-higher-rank');
  }
  return ok(true);
}

export function canRevoke(
  actor: StaffUser,
  target: StaffUser,
  capability: Capability,
): Result<true, Exclude<GrantDenial, 'above-target-ceiling'>> {
  const common = commonGrantChecks(actor, target, capability);
  if (common) {
    return err(common);
  }
  if (ROLE_RANK[actor.role] <= ROLE_RANK[target.role]) {
    return err('not-higher-rank');
  }
  return ok(true);
}

function commonGrantChecks(
  actor: StaffUser,
  target: StaffUser,
  capability: Capability,
): Exclude<GrantDenial, 'above-target-ceiling' | 'not-higher-rank'> | undefined {
  if (actor.tenantId !== target.tenantId) {
    return 'cross-tenant';
  }
  if (actor.id === target.id) {
    return 'self';
  }
  if (!actor.active) {
    return 'actor-inactive';
  }
  const held = effectiveGrants(actor);
  if (!held.has('grants.manage')) {
    return 'no-grants-manage';
  }
  if (!held.has(capability)) {
    return 'actor-lacks-capability';
  }
  return undefined;
}

export type RoleDenial =
  | 'cross-tenant'
  | 'self'
  | 'actor-inactive'
  | 'no-manage-capability'
  | 'role-not-assignable';

export type AssignableRole = Exclude<StaffRole, 'admin'>;

const MANAGE_CAPABILITY: Readonly<Record<AssignableRole, Capability>> = {
  supervisor: 'supervisors.manage',
  agent: 'agents.manage',
};

/**
 * Criar usuário com a role (alvo `{ tenantId }`) ou mudar a role de alguém.
 * Ordem: tenant, self, ator ativo, capacidade de gestão (posse efetiva), atribuibilidade
 * (rank do ator > rank da role atribuída; alvo existente de rank menor).
 * Exige a capacidade da role nova e, se o alvo já é supervisor/agente, a da role atual
 * (rebaixar um supervisor exige `supervisors.manage`). 'admin' não existe como role atribuível (o tipo proíbe), ninguém
 * mexe em admin, e só se mexe em alguém de rank estritamente menor.
 */
export function canAssignRole(
  actor: StaffUser,
  target: StaffUser | { readonly tenantId: TenantId },
  role: AssignableRole,
): Result<true, RoleDenial> {
  if (actor.tenantId !== target.tenantId) {
    return err('cross-tenant');
  }
  const existing = 'id' in target ? target : undefined;
  if (existing && existing.id === actor.id) {
    return err('self');
  }
  if (!actor.active) {
    return err('actor-inactive');
  }
  const needed: Capability[] = [MANAGE_CAPABILITY[role]];
  if (existing && existing.role !== 'admin') {
    needed.push(MANAGE_CAPABILITY[existing.role]);
  }
  // Alvo admin: nenhuma capacidade extra; cai em role-not-assignable abaixo (rank).
  const held = effectiveGrants(actor);
  if (!needed.every((capability) => held.has(capability))) {
    return err('no-manage-capability');
  }
  // Hierarquia sobre a role ATRIBUÍDA, independente dos grants: supervisor só atribui 'agent'.
  if (ROLE_RANK[actor.role] <= ROLE_RANK[role]) {
    return err('role-not-assignable');
  }
  if (existing && ROLE_RANK[actor.role] <= ROLE_RANK[existing.role]) {
    return err('role-not-assignable');
  }
  return ok(true);
}

/** Mudar a role zera os grants para ROLE_DEFAULT da role nova, ∩ teto. */
export function grantsAfterRoleChange(role: StaffRole): Grants {
  return new Set([...ROLE_DEFAULT[role]].filter((capability) => ROLE_CEILING[role].has(capability)));
}
