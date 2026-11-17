import {
  canAssignRole,
  canGrantIn,
  canRevokeIn,
  GRANT_DENIAL_TEXT,
  effectiveGrants,
  inManagementScope,
  resolvePair,
  ROLE_RANK,
  supervisedIlhaIds,
  grantsAfterRoleChange,
  ROLE_CEILING,
  type AssignableRole,
  type Capability,
  type GrantDenial,
  type RoleDenial,
} from './capabilities';
import type { Agent, Directory, Ilha, IlhaId, IlhaIds, StaffUser, UserId } from './identity';
import { own } from './records';
import { err, ok, type Result } from './result';
import type { TenantId } from './tenant';

export type OpError =
  | GrantDenial
  | RoleDenial
  | 'unknown-actor'
  | 'duplicate-user'
  | 'duplicate-ilha'
  | 'invalid-name'
  | 'invalid-supervisor'
  | 'target-not-agent'
  | 'no-change'
  | 'outside-islands'
  | 'not-higher-rank'
  | 'ilha-required'
  | 'unknown-ilha'
  | 'supervises-ilha'
  | 'last-ilha'
  | 'last-supervisor';

type OpResult = Result<Directory, OpError>;

/** Texto curto em português para TODA negação que a UI mostra (um Record exaustivo: erro novo no tipo não compila sem texto). */
export const DENIAL_TEXT: Readonly<Record<OpError, string>> = {
  ...GRANT_DENIAL_TEXT,
  'role-not-assignable': 'acima do papel',
  'no-manage-capability': 'você não possui',
  'unknown-actor': 'usuário desconhecido',
  'duplicate-user': 'usuário já existe',
  'duplicate-ilha': 'ilha já existe',
  'ilha-required': 'escolha uma ilha',
  'unknown-ilha': 'ilha inexistente',
  'supervises-ilha': 'supervisiona uma ilha',
  'last-ilha': 'o agente precisa de ao menos uma ilha',
  'last-supervisor': 'a ilha precisa de ao menos um supervisor',
  'invalid-name': 'nome inválido',
  'invalid-supervisor': 'supervisor inválido',
  'target-not-agent': 'só vale para agente',
  'no-change': 'nada a alterar',
};

export function describeDenial(error: OpError): string {
  return DENIAL_TEXT[error];
}

/** Nome de usuário/ilha: sem espaços nas pontas, não vazio, até 80 caracteres, sem caracteres de controle. */
export const MAX_NAME_LENGTH = 80;
export function validName(name: string): string | undefined {
  const trimmed = name.trim();
  return trimmed === '' || trimmed.length > MAX_NAME_LENGTH || /\p{Cc}/u.test(trimmed) ? undefined : trimmed;
}

function withUser(d: Directory, user: StaffUser): Directory {
  return { ...d, users: { ...d.users, [user.id]: user } };
}

/** Aplica um grant validado por `canGrant`: as mesmas regras que o MockServer usa. */
export function applyGrant(d: Directory, actorId: UserId, targetId: UserId, capability: Capability): OpResult {
  const found = resolvePair(d, actorId, targetId);
  if (!found.ok) {
    return found;
  }
  const { target } = found.value;
  const verdict = canGrantIn(d, actorId, targetId, capability);
  if (!verdict.ok) {
    return verdict;
  }
  return ok(withUser(d, { ...target, grants: new Set([...target.grants, capability]) }));
}

export function applyRevoke(d: Directory, actorId: UserId, targetId: UserId, capability: Capability): OpResult {
  const found = resolvePair(d, actorId, targetId);
  if (!found.ok) {
    return found;
  }
  const { target } = found.value;
  const verdict = canRevokeIn(d, actorId, targetId, capability);
  if (!verdict.ok) {
    return verdict;
  }
  return ok(withUser(d, { ...target, grants: new Set([...target.grants].filter((item) => item !== capability)) }));
}

/** Grants de usuário NOVO: padrão da role ∩ teto ∩ o que o ator tem (ninguém dá o que não tem). */
function initialGrants(actor: StaffUser, role: AssignableRole): ReadonlySet<Capability> {
  const held = effectiveGrants(actor);
  return new Set([...grantsAfterRoleChange(role)].filter((capability) => held.has(capability)));
}

/** A ilha de um agente precisa existir, ser do tenant e ter ao menos um supervisor, todos válidos e do mesmo tenant. */
function checkAgentIlha(d: Directory, ilhaId: IlhaId | undefined): OpError | undefined {
  if (!ilhaId) {
    return 'ilha-required';
  }
  const ilha = own(d.ilhas, ilhaId);
  if (!ilha || ilha.tenantId !== d.tenantId || ilha.supervisorIds.length === 0) {
    return 'unknown-ilha';
  }
  const valid = ilha.supervisorIds.every((id) => {
    const supervisor = own(d.users, id);
    return supervisor?.role === 'supervisor' && supervisor.tenantId === d.tenantId;
  });
  return valid ? undefined : 'unknown-ilha';
}

function isIlhaList(value: IlhaId | readonly IlhaId[]): value is readonly IlhaId[] {
  return Array.isArray(value);
}

/** Ilhas pedidas (sem repetir, na ordem). Vazio: `ilha-required`; qualquer uma inválida: o erro dela. */
function checkAgentIlhas(
  d: Directory,
  ilhaIds: readonly IlhaId[] | undefined,
): Result<IlhaIds, OpError> {
  const unique = [...new Set(ilhaIds ?? [])];
  const [first, ...rest] = unique;
  if (first === undefined) {
    return err('ilha-required');
  }
  for (const ilhaId of unique) {
    const problem = checkAgentIlha(d, ilhaId);
    if (problem) {
      return err(problem);
    }
  }
  return ok([first, ...rest]);
}

/**
 * Muda a ROLE de alguém existente. Só o admin; nunca mexe em grants para MAIS: os grants do alvo
 * ficam como estão, apenas cortados pelo teto da role nova. Agente→agente é `no-change`; mudar as ilhas
 * de um agente é `addAgentToIlha`/`removeAgentFromIlha`. Rebaixar quem supervisiona alguma ilha é recusado.
 */
export function applyAssignRole(
  d: Directory,
  actorId: UserId,
  targetId: UserId,
  role: AssignableRole,
  ilhaIds?: readonly IlhaId[],
): OpResult {
  const found = resolvePair(d, actorId, targetId);
  if (!found.ok) {
    return found;
  }
  const { actor, target } = found.value;
  const verdict = canAssignRole(actor, target, role);
  if (!verdict.ok) {
    return verdict;
  }
  if (actor.role !== 'admin') {
    return err('role-not-assignable');
  }
  if (target.role === role) {
    return err('no-change');
  }
  if (
    role !== 'supervisor' &&
    target.role === 'supervisor' &&
    Object.values(d.ilhas).some((ilha) => ilha.supervisorIds.includes(target.id))
  ) {
    return err('supervises-ilha');
  }
  const grants = new Set([...target.grants].filter((capability) => ROLE_CEILING[role].has(capability)));
  const base = { id: target.id, tenantId: target.tenantId, name: target.name, active: target.active, grants };
  if (role === 'supervisor') {
    return ok(withUser(d, { ...base, role }));
  }
  const checked = checkAgentIlhas(d, ilhaIds);
  if (!checked.ok) {
    return checked;
  }
  const agent: Agent = { ...base, role, ilhaIds: checked.value };
  return ok(withUser(d, agent));
}

export type NewUser = {
  readonly id: UserId;
  readonly name: string;
  readonly role: AssignableRole;
  /** Agente: ao menos uma. Ignorado no supervisor. */
  readonly ilhaIds?: readonly IlhaId[];
};

/** Cadastro de usuário novo. Autorização pelos mesmos predicados que a UI usa. */
export function applyCreate(d: Directory, actorId: UserId, input: NewUser): OpResult {
  const allowed = input.role === 'agent' ? canRegisterAgentIn(d, actorId, input.ilhaIds) : canRegisterSupervisorIn(d, actorId);
  if (!allowed.ok) {
    return allowed;
  }
  const actor = own(d.users, actorId);
  const name = validName(input.name);
  if (!actor || !name) {
    return err(actor ? 'invalid-name' : 'unknown-actor');
  }
  if (own(d.users, input.id) !== undefined) {
    return err('duplicate-user');
  }
  const base = { id: input.id, tenantId: d.tenantId, name, active: true, grants: initialGrants(actor, input.role) };
  if (input.role === 'supervisor') {
    return ok(withUser(d, { ...base, role: 'supervisor' }));
  }
  const checked = checkAgentIlhas(d, input.ilhaIds);
  if (!checked.ok) {
    return checked;
  }
  const agent: Agent = { ...base, role: 'agent', ilhaIds: checked.value };
  return ok(withUser(d, agent));
}

// ---------------------------------------------------------------------------
// Operações do console de administração (Etapa 5). Puras: estado + ator (id) + parâmetros
// → Result com o novo estado. Relógio e geradores de id são injetados; sem mutação.
// ---------------------------------------------------------------------------

export type GrantLogEntry = {
  readonly tenantId: TenantId;
  /** Quem. */
  readonly actorId: UserId;
  /** Para quem. */
  readonly targetId: UserId;
  /** O quê. */
  readonly capability: Capability;
  /** true = concedeu; false = revogou. */
  readonly granted: boolean;
  /** Quando (ISO, do relógio injetado). */
  readonly at: string;
};

export type AdminState = {
  readonly directory: Directory;
  /** Só cresce, e só em operação aceita que mudou algo. */
  readonly grantLog: readonly GrantLogEntry[];
};

export type OpDeps = {
  readonly now: () => string;
  readonly newUserId: () => UserId;
  readonly newIlhaId: () => IlhaId;
};

export type AdminResult = Result<AdminState, OpError>;

function withDirectory(state: AdminState, directory: Directory): AdminState {
  return { ...state, directory };
}

function withIlha(d: Directory, ilha: Ilha): Directory {
  return { ...d, ilhas: { ...d.ilhas, [ilha.id]: ilha } };
}

/** "Este usuário pode conectar?" Único predicado: existe neste tenant e não está desativado. */
export function canConnect(d: Directory, userId: UserId): boolean {
  const user = own(d.users, userId);
  return user !== undefined && user.tenantId === d.tenantId && user.active;
}

type Verdict = Result<true, OpError>;

/** Ator para ação de administração sem alvo-usuário: tenant, ator ativo, capacidade (posse efetiva). */
function authorizeAdmin(d: Directory, actorId: UserId, capability: Capability): Result<StaffUser, OpError> {
  const actor = own(d.users, actorId);
  if (!actor) {
    return err('unknown-actor');
  }
  if (actor.tenantId !== d.tenantId) {
    return err('cross-tenant');
  }
  if (!actor.active) {
    return err('actor-inactive');
  }
  return effectiveGrants(actor).has(capability) ? ok(actor) : err('no-manage-capability');
}

const TARGET_CAPABILITY: Readonly<Record<StaffUser['role'], Capability | undefined>> = {
  admin: undefined,
  supervisor: 'supervisors.manage',
  agent: 'agents.manage',
};

/**
 * Ator e alvo do diretório. Ordem: tenant, self, ator ativo, capacidade de gestão da role do alvo,
 * hierarquia (rank do ator > rank do alvo; ninguém mexe no admin), escopo de ilha (supervisor).
 */
function authorizeTarget(d: Directory, actorId: UserId, targetId: UserId): Result<{ actor: StaffUser; target: StaffUser }, OpError> {
  const pair = resolvePair(d, actorId, targetId);
  if (!pair.ok) {
    return pair;
  }
  const { actor, target } = pair.value;
  if (actor.id === target.id) {
    return err('self');
  }
  if (!actor.active) {
    return err('actor-inactive');
  }
  const needed = TARGET_CAPABILITY[target.role];
  if (needed && !effectiveGrants(actor).has(needed)) {
    return err('no-manage-capability');
  }
  if (ROLE_RANK[actor.role] <= ROLE_RANK[target.role]) {
    return err('not-higher-rank');
  }
  if (!inManagementScope(d, actor, target)) {
    return err('outside-islands');
  }
  return ok({ actor, target });
}

// Predicados SEM efeito, com diretório: a UI os usa para habilitar/desabilitar e mostrar o motivo,
// e as operações abaixo chamam estes mesmos predicados (uma única fonte de verdade).
// Só `no-change` (estado de destino já alcançado) é checado apenas na operação.

/** Cadastrar agente nas ilhas: admin em qualquer ilha válida do tenant; supervisor só se supervisiona TODAS as pedidas. Uma ilha só ou uma lista. */
export function canRegisterAgentIn(d: Directory, actorId: UserId, ilhas: IlhaId | readonly IlhaId[] | undefined): Verdict {
  const actor = own(d.users, actorId);
  if (!actor) {
    return err('unknown-actor');
  }
  const role = canAssignRole(actor, { tenantId: d.tenantId }, 'agent');
  if (!role.ok) {
    return role;
  }
  const requested = ilhas === undefined ? undefined : isIlhaList(ilhas) ? ilhas : [ilhas];
  const checked = checkAgentIlhas(d, requested);
  if (!checked.ok) {
    return checked;
  }
  if (actor.role === 'supervisor') {
    const mine = supervisedIlhaIds(d, actor.id);
    if (!checked.value.every((ilhaId) => mine.has(ilhaId))) {
      return err('outside-islands');
    }
  }
  return ok(true);
}

/** Cadastrar supervisor: só o admin (supervisors.manage). */
export function canRegisterSupervisorIn(d: Directory, actorId: UserId): Verdict {
  const actor = own(d.users, actorId);
  if (!actor) {
    return err('unknown-actor');
  }
  const role = canAssignRole(actor, { tenantId: d.tenantId }, 'supervisor');
  return role.ok ? ok(true) : role;
}

/** Criar/renomear ilha e atribuir supervisor: só quem tem ilhas.manage (admin). */
export function canManageIlhasIn(d: Directory, actorId: UserId): Verdict {
  const actor = authorizeAdmin(d, actorId, 'ilhas.manage');
  return actor.ok ? ok(true) : actor;
}

/** Ator ativo do tenant com a capacidade (posse efetiva). Para a UI esconder/mostrar entradas (ex.: "Novo grupo"). */
export function canUseCapabilityIn(d: Directory, actorId: UserId, capability: Capability): Verdict {
  const actor = authorizeAdmin(d, actorId, capability);
  return actor.ok ? ok(true) : actor;
}

/** As ilhas que o ator gere: admin, todas do tenant; supervisor, as que ele supervisiona; agente, nenhuma. */
export function manageableIlhas(d: Directory, actorId: UserId): readonly Ilha[] {
  const actor = own(d.users, actorId);
  if (!actor || actor.tenantId !== d.tenantId || !actor.active) {
    return [];
  }
  const ilhas = Object.values(d.ilhas).filter((ilha) => ilha.tenantId === d.tenantId);
  if (actor.role === 'admin') {
    return ilhas;
  }
  const mine = supervisedIlhaIds(d, actor.id);
  return actor.role === 'supervisor' ? ilhas.filter((ilha) => mine.has(ilha.id)) : [];
}

/** Tela "Equipe": quem cadastra agentes (`agents.manage`) E supervisiona ilhas. O admin (sem ilhas próprias) usa a Administração. */
export function canViewTeamIn(d: Directory, actorId: UserId): Verdict {
  const allowed = canUseCapabilityIn(d, actorId, 'agents.manage');
  if (!allowed.ok) {
    return allowed;
  }
  return supervisedIlhaIds(d, actorId).size > 0 ? ok(true) : err('outside-islands');
}

/** Desativar ou reativar o alvo. */
export function canSetActiveIn(d: Directory, actorId: UserId, targetId: UserId): Verdict {
  const authorized = authorizeTarget(d, actorId, targetId);
  return authorized.ok ? ok(true) : authorized;
}

/**
 * Acrescentar o vínculo agente-ilha (mover vira adicionar/remover vínculo; plano da fusão, C2).
 * O agente tem de estar no escopo do ator (alguma ilha dele) E a ilha de destino tem de ser dele;
 * o admin, qualquer ilha do tenant. Vínculo já existente é `no-change` (checado só na operação).
 */
export function canAddAgentToIlhaIn(d: Directory, actorId: UserId, agentId: UserId, ilhaId: IlhaId): Verdict {
  const authorized = authorizeTarget(d, actorId, agentId);
  if (!authorized.ok) {
    return authorized;
  }
  const { actor, target } = authorized.value;
  if (target.role !== 'agent') {
    return err('target-not-agent');
  }
  const problem = checkAgentIlha(d, ilhaId);
  if (problem) {
    return err(problem);
  }
  return actor.role === 'supervisor' && !supervisedIlhaIds(d, actor.id).has(ilhaId) ? err('outside-islands') : ok(true);
}

/**
 * Remover o vínculo agente-ilha: o supervisor só tira vínculo de ilha DELE (nunca puxa o agente de
 * ilha de outro supervisor); o último vínculo não sai (`last-ilha`), nem para o admin. Vínculo
 * inexistente é `no-change` (checado só na operação).
 */
export function canRemoveAgentFromIlhaIn(d: Directory, actorId: UserId, agentId: UserId, ilhaId: IlhaId): Verdict {
  const authorized = authorizeTarget(d, actorId, agentId);
  if (!authorized.ok) {
    return authorized;
  }
  const { actor, target } = authorized.value;
  if (target.role !== 'agent') {
    return err('target-not-agent');
  }
  const ilha = own(d.ilhas, ilhaId);
  if (!ilha || ilha.tenantId !== d.tenantId) {
    return err('unknown-ilha');
  }
  if (actor.role === 'supervisor' && !supervisedIlhaIds(d, actor.id).has(ilhaId)) {
    return err('outside-islands');
  }
  return target.ilhaIds.includes(ilhaId) && target.ilhaIds.length === 1 ? err('last-ilha') : ok(true);
}

export function registerSupervisor(
  state: AdminState,
  actorId: UserId,
  input: { readonly name: string; readonly ilhaIds: readonly IlhaId[] },
  deps: OpDeps,
): AdminResult {
  const d = state.directory;
  const allowed = canRegisterSupervisorIn(d, actorId);
  if (!allowed.ok) {
    return allowed;
  }
  const name = validName(input.name);
  if (!name) {
    return err('invalid-name');
  }
  const ilhas: Ilha[] = [];
  for (const id of new Set(input.ilhaIds)) {
    const ilha = own(d.ilhas, id);
    if (!ilha || ilha.tenantId !== d.tenantId) {
      return err('unknown-ilha');
    }
    ilhas.push(ilha);
  }
  // O id só é gerado depois de autorizar e validar: operação negada não consome gerador.
  const id = deps.newUserId();
  const created = applyCreate(d, actorId, { id, name, role: 'supervisor' });
  if (!created.ok) {
    return created;
  }
  let next = created.value;
  for (const ilha of ilhas) {
    next = withIlha(next, { ...ilha, supervisorIds: [...ilha.supervisorIds, id] });
  }
  return ok(withDirectory(state, next));
}

export function registerAgent(
  state: AdminState,
  actorId: UserId,
  input: { readonly name: string; readonly ilhaIds: readonly IlhaId[] },
  deps: OpDeps,
): AdminResult {
  const allowed = canRegisterAgentIn(state.directory, actorId, input.ilhaIds);
  if (!allowed.ok) {
    return allowed;
  }
  const name = validName(input.name);
  if (!name) {
    return err('invalid-name');
  }
  const created = applyCreate(state.directory, actorId, { id: deps.newUserId(), name, role: 'agent', ilhaIds: input.ilhaIds });
  return created.ok ? ok(withDirectory(state, created.value)) : created;
}

function setActive(state: AdminState, actorId: UserId, targetId: UserId, active: boolean): AdminResult {
  const allowed = canSetActiveIn(state.directory, actorId, targetId);
  const target = own(state.directory.users, targetId);
  if (!allowed.ok) {
    return allowed;
  }
  if (!target) {
    return err('cross-tenant');
  }
  if (target.active === active) {
    return err('no-change');
  }
  return ok(withDirectory(state, withUser(state.directory, { ...target, active })));
}

/** Bloqueia o login e preserva o histórico (o registro continua no diretório). */
export function deactivateUser(state: AdminState, actorId: UserId, targetId: UserId): AdminResult {
  return setActive(state, actorId, targetId, false);
}

export function reactivateUser(state: AdminState, actorId: UserId, targetId: UserId): AdminResult {
  return setActive(state, actorId, targetId, true);
}

export function createIlha(
  state: AdminState,
  actorId: UserId,
  input: { readonly name: string; readonly supervisorIds: readonly UserId[] },
  deps: OpDeps,
): AdminResult {
  const d = state.directory;
  const allowed = canManageIlhasIn(d, actorId);
  if (!allowed.ok) {
    return allowed;
  }
  const name = validName(input.name);
  if (!name) {
    return err('invalid-name');
  }
  // Ao menos um supervisor, todos usáveis (ativos, do tenant); repetidos contam uma vez.
  const supervisorIds = [...new Set(input.supervisorIds)];
  if (supervisorIds.length === 0 || !supervisorIds.every((id) => isUsableSupervisor(d, id))) {
    return err('invalid-supervisor');
  }
  const id = deps.newIlhaId();
  if (own(d.ilhas, id) !== undefined) {
    return err('duplicate-ilha');
  }
  return ok(withDirectory(state, withIlha(d, { id, tenantId: d.tenantId, name, supervisorIds })));
}

export function renameIlha(state: AdminState, actorId: UserId, ilhaId: IlhaId, name: string): AdminResult {
  const d = state.directory;
  const allowed = canManageIlhasIn(d, actorId);
  if (!allowed.ok) {
    return allowed;
  }
  const ilha = own(d.ilhas, ilhaId);
  if (!ilha || ilha.tenantId !== d.tenantId) {
    return err('unknown-ilha');
  }
  const clean = validName(name);
  if (!clean) {
    return err('invalid-name');
  }
  if (clean === ilha.name) {
    return err('no-change');
  }
  return ok(withDirectory(state, withIlha(d, { ...ilha, name: clean })));
}

/**
 * Supervisor DESATIVADO continua dono das suas ilhas (os agentes não ficam órfãos): o admin ainda
 * cadastra e move agentes para elas; o supervisor desativado, como ator, é negado em tudo.
 * Para ser supervisor de uma ilha NOVA ou reatribuída, porém, tem de estar ativo.
 */
function isUsableSupervisor(d: Directory, id: UserId): boolean {
  const supervisor = own(d.users, id);
  return supervisor?.role === 'supervisor' && supervisor.tenantId === d.tenantId && supervisor.active;
}

/** Acrescenta um supervisor à ilha (N:N): os que já estavam continuam. */
export function assignIlhaSupervisor(state: AdminState, actorId: UserId, ilhaId: IlhaId, supervisorId: UserId): AdminResult {
  const d = state.directory;
  const allowed = canManageIlhasIn(d, actorId);
  if (!allowed.ok) {
    return allowed;
  }
  const ilha = own(d.ilhas, ilhaId);
  if (!ilha || ilha.tenantId !== d.tenantId) {
    return err('unknown-ilha');
  }
  if (!isUsableSupervisor(d, supervisorId)) {
    return err('invalid-supervisor');
  }
  if (ilha.supervisorIds.includes(supervisorId)) {
    return err('no-change');
  }
  return ok(withDirectory(state, withIlha(d, { ...ilha, supervisorIds: [...ilha.supervisorIds, supervisorId] })));
}

/**
 * Tira UM supervisor da ilha (só o admin, `ilhas.manage`). Não mexe nos grants de ninguém (sem cascata).
 * A ilha nunca fica sem supervisor por operação: o último não sai.
 */
export function unassignIlhaSupervisor(state: AdminState, actorId: UserId, ilhaId: IlhaId, supervisorId: UserId): AdminResult {
  const d = state.directory;
  const allowed = canManageIlhasIn(d, actorId);
  if (!allowed.ok) {
    return allowed;
  }
  const ilha = own(d.ilhas, ilhaId);
  if (!ilha || ilha.tenantId !== d.tenantId) {
    return err('unknown-ilha');
  }
  if (!ilha.supervisorIds.includes(supervisorId)) {
    return err('no-change');
  }
  if (ilha.supervisorIds.length === 1) {
    return err('last-supervisor');
  }
  return ok(withDirectory(state, withIlha(d, { ...ilha, supervisorIds: ilha.supervisorIds.filter((id) => id !== supervisorId) })));
}

export function addAgentToIlha(state: AdminState, actorId: UserId, agentId: UserId, ilhaId: IlhaId): AdminResult {
  const d = state.directory;
  const allowed = canAddAgentToIlhaIn(d, actorId, agentId, ilhaId);
  if (!allowed.ok) {
    return allowed;
  }
  const target = own(d.users, agentId);
  if (target?.role !== 'agent') {
    return err('target-not-agent');
  }
  if (target.ilhaIds.includes(ilhaId)) {
    return err('no-change');
  }
  return ok(withDirectory(state, withUser(d, { ...target, ilhaIds: [...target.ilhaIds, ilhaId] })));
}

export function removeAgentFromIlha(state: AdminState, actorId: UserId, agentId: UserId, ilhaId: IlhaId): AdminResult {
  const d = state.directory;
  const allowed = canRemoveAgentFromIlhaIn(d, actorId, agentId, ilhaId);
  if (!allowed.ok) {
    return allowed;
  }
  const target = own(d.users, agentId);
  if (target?.role !== 'agent') {
    return err('target-not-agent');
  }
  if (!target.ilhaIds.includes(ilhaId)) {
    return err('no-change');
  }
  const [first, ...rest] = target.ilhaIds.filter((id) => id !== ilhaId);
  // `canRemoveAgentFromIlhaIn` já recusou o último vínculo; o guard só prova o tipo `[IlhaId, ...IlhaId[]]`.
  return first === undefined ? err('last-ilha') : ok(withDirectory(state, withUser(d, { ...target, ilhaIds: [first, ...rest] })));
}

function changeGrant(
  state: AdminState,
  actorId: UserId,
  targetId: UserId,
  capability: Capability,
  granted: boolean,
  deps: OpDeps,
): AdminResult {
  const before = own(state.directory.users, targetId);
  const next = (granted ? applyGrant : applyRevoke)(state.directory, actorId, targetId, capability);
  if (!next.ok) {
    return next;
  }
  const after = own(next.value.users, targetId);
  if (!before || !after || before.grants.has(capability) === after.grants.has(capability)) {
    return err('no-change');
  }
  const entry: GrantLogEntry = {
    tenantId: state.directory.tenantId,
    actorId,
    targetId,
    capability,
    granted,
    at: deps.now(),
  };
  return ok({ directory: next.value, grantLog: [...state.grantLog, entry] });
}

export function grantCapability(state: AdminState, actorId: UserId, targetId: UserId, capability: Capability, deps: OpDeps): AdminResult {
  return changeGrant(state, actorId, targetId, capability, true, deps);
}

export function revokeCapability(state: AdminState, actorId: UserId, targetId: UserId, capability: Capability, deps: OpDeps): AdminResult {
  return changeGrant(state, actorId, targetId, capability, false, deps);
}
