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
export type Agent = UserBase & { readonly role: 'agent'; readonly ilhaId: IlhaId };
/** Reservado para o canal do cliente. Nunca entra em sessão interna. */
export type ClientUser = Omit<UserBase, 'grants'> & { readonly role: 'client' };

export type User = Admin | Supervisor | Agent | ClientUser;
export type StaffUser = Admin | Supervisor | Agent;

export type Ilha = {
  readonly id: IlhaId;
  readonly tenantId: TenantId;
  readonly name: string;
  readonly supervisorId: UserId;
};

/** Sempre de UM tenant. O tipo não impede misturar; validateDirectory e os testes de isolamento impedem. */
export type Directory = {
  readonly tenantId: TenantId;
  readonly users: Readonly<Record<UserId, StaffUser>>;
  readonly ilhas: Readonly<Record<IlhaId, Ilha>>;
};

export type DirectoryError = 'cross-tenant' | 'orphan-agent' | 'grant-above-ceiling' | 'multiple-admins';

/** Ordem: cross-tenant, orphan-agent, grant-above-ceiling, multiple-admins. */
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
    const ilha = own(d.ilhas, user.ilhaId);
    const supervisor = ilha ? own(d.users, ilha.supervisorId) : undefined;
    if (supervisor?.role !== 'supervisor') {
      return err('orphan-agent');
    }
  }
  for (const user of users) {
    for (const capability of user.grants) {
      if (!ROLE_CEILING[user.role].has(capability)) {
        return err('grant-above-ceiling');
      }
    }
  }
  if (users.filter((user) => user.role === 'admin').length > 1) {
    return err('multiple-admins');
  }
  return ok(d);
}

export function supervisorOf(d: Directory, agent: Agent): Supervisor | undefined {
  const ilha = own(d.ilhas, agent.ilhaId);
  const supervisor = ilha ? own(d.users, ilha.supervisorId) : undefined;
  return supervisor?.role === 'supervisor' ? supervisor : undefined;
}

export type ParseStaffUserError = { readonly error: 'client-not-supported' | 'invalid' };

/** Valida um objeto cru (ex.: JSON do servidor). `grants` chega como array de strings. */
export function parseStaffUser(raw: unknown): StaffUser | ParseStaffUserError {
  if (typeof raw !== 'object' || raw === null) {
    return { error: 'invalid' };
  }
  const record = raw as Record<string, unknown>;
  const { id, tenantId, name, active, role, grants, ilhaId } = record;
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
  if (role === 'agent' && typeof ilhaId === 'string' && ilhaId !== '') {
    return { ...base, role, ilhaId: ilhaId as IlhaId };
  }
  return { error: 'invalid' };
}

/** Mantido pelo servidor (mock/SM), não pelo front. */
export type LoginRecord = { readonly userId: UserId; readonly lastLoginDate: LocalDate | null };
