import type { Directory, StaffRole, StaffUser, UserId } from './identity';
import { own } from './records';
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
  | 'not-higher-rank' // só concede para role estritamente abaixo
  | 'outside-islands'; // supervisor só mexe em agente das ilhas que supervisiona

/** Motivos legíveis (pt-BR) que a UI mostra numa chave bloqueada. */
export const GRANT_DENIAL_TEXT: Readonly<Record<GrantDenial, string>> = {
  'cross-tenant': 'outra empresa',
  self: 'não pode alterar a si mesmo',
  'actor-inactive': 'usuário desativado',
  'no-grants-manage': 'sem permissão para gerenciar permissões',
  'actor-lacks-capability': 'você não possui',
  'above-target-ceiling': 'acima do papel',
  'not-higher-rank': 'acima do papel',
  'outside-islands': 'fora das suas ilhas',
};

export function describeGrantDenial(denial: GrantDenial): string {
  return GRANT_DENIAL_TEXT[denial];
}

/**
 * Ator e alvo SEMPRE do diretório (por id). Tenant é a primeira checagem: o registro do ator
 * e o do alvo têm de ser do tenant do diretório. Alvo ausente (inexistente ou de outra empresa)
 * dá 'cross-tenant', indistinguível, para não revelar nada sobre outra empresa.
 */
export function resolvePair(
  d: Directory,
  actorId: UserId,
  targetId: UserId,
): Result<{ actor: StaffUser; target: StaffUser }, 'unknown-actor' | 'cross-tenant'> {
  const actor = own(d.users, actorId);
  if (!actor) {
    return err('unknown-actor');
  }
  const target = own(d.users, targetId);
  if (actor.tenantId !== d.tenantId || !target || target.tenantId !== d.tenantId) {
    return err('cross-tenant');
  }
  return ok({ actor, target });
}

/** Ilhas que o supervisor supervisiona (do tenant do diretório). */
export function supervisedIlhaIds(d: Directory, supervisorId: UserId): ReadonlySet<string> {
  return new Set(
    Object.values(d.ilhas)
      .filter((ilha) => ilha.supervisorIds.includes(supervisorId) && ilha.tenantId === d.tenantId)
      .map((ilha) => ilha.id),
  );
}

/** Escopo de gestão sobre o alvo: admin, qualquer um do tenant; supervisor, só agente de ALGUMA ilha dele (N:N); agente, ninguém. */
export function inManagementScope(d: Directory, actor: StaffUser, target: StaffUser): boolean {
  if (actor.tenantId !== d.tenantId || target.tenantId !== d.tenantId) {
    return false;
  }
  if (actor.role === 'admin') {
    return true;
  }
  if (actor.role === 'supervisor') {
    if (target.role !== 'agent') {
      return false;
    }
    const mine = supervisedIlhaIds(d, actor.id);
    return target.ilhaIds.some((ilhaId) => mine.has(ilhaId));
  }
  return false;
}

/** Regra de papel isolada; não usar para autorizar (sem diretório e sem escopo de ilha): use `canGrantIn`. Ordem (§2.7): tenant, self, ator ativo + grants.manage, posse, teto do alvo, hierarquia. */
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

/** Regra de papel isolada; não usar para autorizar: use `canRevokeIn` (diretório + escopo de ilha). */
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

/** canGrant com escopo: ator e alvo vêm do diretório; supervisor só concede a agente das suas ilhas. */
export function canGrantIn(
  d: Directory,
  actorId: UserId,
  targetId: UserId,
  capability: Capability,
): Result<true, GrantDenial | 'unknown-actor'> {
  const pair = resolvePair(d, actorId, targetId);
  if (!pair.ok) {
    return pair;
  }
  const { actor, target } = pair.value;
  const verdict = canGrant(actor, target, capability);
  if (!verdict.ok) {
    return verdict;
  }
  return actor.role === 'supervisor' && !inManagementScope(d, actor, target) ? err('outside-islands') : ok(true);
}

export function canRevokeIn(
  d: Directory,
  actorId: UserId,
  targetId: UserId,
  capability: Capability,
): Result<true, Exclude<GrantDenial, 'above-target-ceiling'> | 'unknown-actor'> {
  const pair = resolvePair(d, actorId, targetId);
  if (!pair.ok) {
    return pair;
  }
  const { actor, target } = pair.value;
  const verdict = canRevoke(actor, target, capability);
  if (!verdict.ok) {
    return verdict;
  }
  return actor.role === 'supervisor' && !inManagementScope(d, actor, target) ? err('outside-islands') : ok(true);
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
 *
 * Regra de papel isolada; não usar para autorizar sozinha: as operações com diretório
 * estão em `directoryOps` (`canRegisterAgentIn` etc.).
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
