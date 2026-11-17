import { CAPABILITIES, ROLE_CEILING, type Capability, type Grants } from './capabilities';
import { own } from './records';
import { err, ok, type Result } from './result';
import type { Brand, LocalDate, TenantId } from './tenant';

export type UserId = Brand<string, 'UserId'>;
export type IlhaId = Brand<string, 'IlhaId'>;

export type Role = 'admin' | 'supervisor' | 'agent' | 'client';
/** Roles internas (staff). Única definição; capabilities e o resto importam daqui. */
export type StaffRole = Exclude<Role, 'client'>;

type UserBase = {
  readonly id: UserId;
  readonly tenantId: TenantId;
  readonly name: string;
  /** Desativado não loga; o histórico fica. */
  readonly active: boolean;
  /** Sempre ⊆ teto da role. */
  readonly grants: Grants;
};

/** Dono da empresa. Criado fora do app (provisionamento); um por empresa. */
export type Admin = UserBase & { readonly role: 'admin' };
export type Supervisor = UserBase & { readonly role: 'supervisor' };
/** Ao menos uma ilha, sem repetição (N:N: o agente pode estar em várias; plano da fusão, C2/D1). */
export type IlhaIds = readonly [IlhaId, ...IlhaId[]];
export type Agent = UserBase & { readonly role: 'agent'; readonly ilhaIds: IlhaIds };
/** Reservado para o canal do cliente. Nunca entra em sessão interna. */
export type ClientUser = Omit<UserBase, 'grants'> & { readonly role: 'client' };

export type User = Admin | Supervisor | Agent | ClientUser;
export type StaffUser = Admin | Supervisor | Agent;

export type Ilha = {
  readonly id: IlhaId;
  readonly tenantId: TenantId;
  readonly name: string;
  /** N:N: uma ilha pode ter vários supervisores. O tipo admite 0 (ilha sem agentes); com agente, exige ≥1. */
  readonly supervisorIds: readonly UserId[];
};

/** Sempre de UM tenant. O tipo não impede misturar; validateDirectory e os testes de isolamento impedem. */
export type Directory = {
  readonly tenantId: TenantId;
  readonly users: Readonly<Record<UserId, StaffUser>>;
  readonly ilhas: Readonly<Record<IlhaId, Ilha>>;
};

export type DirectoryError = 'cross-tenant' | 'orphan-agent' | 'grant-above-ceiling' | 'multiple-admins' | 'no-active-admin';

/** Ordem: cross-tenant, orphan-agent, grant-above-ceiling, multiple-admins, no-active-admin. */
export function validateDirectory(d: Directory): Result<Directory, DirectoryError> {
  const users = Object.values(d.users);
  const ilhas = Object.values(d.ilhas);
  if (users.some((user) => user.tenantId !== d.tenantId) || ilhas.some((ilha) => ilha.tenantId !== d.tenantId)) {
    return err('cross-tenant');
  }
  for (const user of users) {
    if (user.role !== 'agent') {
      continue;
    }
    // Todas as ilhas do agente existem, sem repetição, e cada uma tem ao menos um supervisor, todos válidos.
    const ilhaIds: readonly IlhaId[] = user.ilhaIds;
    if (ilhaIds.length === 0 || new Set(ilhaIds).size !== ilhaIds.length) {
      return err('orphan-agent');
    }
    for (const ilhaId of ilhaIds) {
      const ilha = own(d.ilhas, ilhaId);
      if (!ilha || ilha.supervisorIds.length === 0 || !ilha.supervisorIds.every((id) => own(d.users, id)?.role === 'supervisor')) {
        return err('orphan-agent');
      }
    }
  }
  for (const user of users) {
    for (const capability of user.grants) {
      if (!ROLE_CEILING[user.role].has(capability)) {
        return err('grant-above-ceiling');
      }
    }
  }
  const admins = users.filter((user) => user.role === 'admin');
  if (admins.length > 1) {
    return err('multiple-admins');
  }
  // Exatamente um admin e ativo: nenhuma operação do domínio produz zero admin ou admin inativo
  // (o admin não é alvo de desativação); só um estado adulterado chega aqui assim.
  if (admins[0]?.active !== true) {
    return err('no-active-admin');
  }
  return ok(d);
}

/** Supervisores do agente: os de TODAS as ilhas dele, sem repetir (ordem das ilhas, depois a de `supervisorIds`). */
export function supervisorsOf(d: Directory, agent: Agent): readonly Supervisor[] {
  const found = new Map<UserId, Supervisor>();
  for (const ilhaId of agent.ilhaIds) {
    const ilha = own(d.ilhas, ilhaId);
    for (const id of ilha?.supervisorIds ?? []) {
      const supervisor = own(d.users, id);
      if (supervisor?.role === 'supervisor') {
        found.set(supervisor.id, supervisor);
      }
    }
  }
  return [...found.values()];
}

export type ParseStaffUserError = { readonly error: 'client-not-supported' | 'invalid' };

/** Valida um objeto cru (ex.: JSON do servidor). `grants` chega como array de strings. */
export function parseStaffUser(raw: unknown): StaffUser | ParseStaffUserError {
  if (typeof raw !== 'object' || raw === null) {
    return { error: 'invalid' };
  }
  const record = raw as Record<string, unknown>;
  const { id, tenantId, name, active, role, grants, ilhaIds } = record;
  if (role === 'client') {
    return { error: 'client-not-supported' };
  }
  if (
    typeof id !== 'string' ||
    id === '' ||
    typeof tenantId !== 'string' ||
    tenantId === '' ||
    typeof name !== 'string' ||
    typeof active !== 'boolean' ||
    !Array.isArray(grants)
  ) {
    return { error: 'invalid' };
  }
  const known = new Set<string>(CAPABILITIES);
  const granted = new Set<Capability>();
  for (const item of grants as unknown[]) {
    if (typeof item !== 'string' || !known.has(item)) {
      return { error: 'invalid' };
    }
    granted.add(item as Capability);
  }
  const base = { id: id as UserId, tenantId: tenantId as TenantId, name, active, grants: granted };
  if (role === 'admin' || role === 'supervisor') {
    return { ...base, role };
  }
  if (role === 'agent' && Array.isArray(ilhaIds)) {
    const list = ilhaIds as unknown[];
    const valid = list.every((item): item is string => typeof item === 'string' && item !== '');
    if (valid && list.length > 0 && new Set(list).size === list.length) {
      const [first, ...rest] = list;
      return { ...base, role, ilhaIds: [first as IlhaId, ...(rest as IlhaId[])] };
    }
  }
  return { error: 'invalid' };
}

/** Mantido pelo servidor (mock/SM), não pelo front. */
export type LoginRecord = { readonly userId: UserId; readonly lastLoginDate: LocalDate | null };
