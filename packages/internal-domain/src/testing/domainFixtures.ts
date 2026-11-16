import { ROLE_DEFAULT, type Capability } from '../capabilities';
import type { Agent, Directory, Ilha, IlhaId, StaffRole, StaffUser, UserId } from '../identity';
import type { TenantId } from '../tenant';

export const T1 = 'empresa-1' as TenantId;
export const T2 = 'empresa-2' as TenantId;
export const uid = (value: string): UserId => value as UserId;
export const iid = (value: string): IlhaId => value as IlhaId;

type Role = StaffRole;

export function makeUser(
  role: Role,
  id: string,
  options: {
    tenantId?: TenantId;
    active?: boolean;
    grants?: readonly Capability[];
    ilhaId?: IlhaId;
    name?: string;
  } = {},
): StaffUser {
  const base = {
    id: uid(id),
    tenantId: options.tenantId ?? T1,
    name: options.name ?? id,
    active: options.active ?? true,
    grants: new Set<Capability>(options.grants ?? ROLE_DEFAULT[role]),
  };
  if (role === 'agent') {
    const agent: Agent = { ...base, role, ilhaId: options.ilhaId ?? iid('ilha-1') };
    return agent;
  }
  return { ...base, role };
}

export function makeDirectory(tenantId: TenantId, users: readonly StaffUser[], ilhas: readonly Ilha[]): Directory {
  return {
    tenantId,
    users: Object.fromEntries(users.map((user) => [user.id, user])),
    ilhas: Object.fromEntries(ilhas.map((ilha) => [ilha.id, ilha])),
  };
}

export function makeIlha(id: string, supervisorId: string, tenantId: TenantId = T1): Ilha {
  return { id: iid(id), tenantId, name: id, supervisorId: uid(supervisorId) };
}

/** Empresa T1: admin, 2 supervisores (uma ilha cada) e 4 agentes. */
export function seedDirectory(tenantId: TenantId = T1): Directory {
  const suffix = tenantId === T1 ? '' : '-b';
  const id = (name: string) => `${name}${suffix}`;
  return makeDirectory(
    tenantId,
    [
      makeUser('admin', id('admin'), { tenantId }),
      makeUser('supervisor', id('sup-1'), { tenantId }),
      makeUser('supervisor', id('sup-2'), { tenantId }),
      makeUser('agent', id('ag-1'), { tenantId, ilhaId: iid(id('ilha-1')) }),
      makeUser('agent', id('ag-2'), { tenantId, ilhaId: iid(id('ilha-1')) }),
      makeUser('agent', id('ag-3'), { tenantId, ilhaId: iid(id('ilha-2')) }),
      makeUser('agent', id('ag-4'), { tenantId, ilhaId: iid(id('ilha-2')) }),
    ],
    [makeIlha(id('ilha-1'), id('sup-1'), tenantId), makeIlha(id('ilha-2'), id('sup-2'), tenantId)],
  );
}

export function user(d: Directory, id: string): StaffUser {
  const found = d.users[uid(id)];
  if (!found) {
    throw new Error(`usuário ausente no fixture: ${id}`);
  }
  return found;
}

