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
    /** Ilhas do agente (N:N). Padrão: `ilha-1`. Ignorado nas outras roles. */
    ilhaIds?: readonly IlhaId[];
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
    const [first, ...rest] = options.ilhaIds ?? [iid('ilha-1')];
    const agent: Agent = { ...base, role, ilhaIds: [first ?? iid('ilha-1'), ...rest] };
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

/** `supervisors`: um id ou vários (ilha N:N com 2 supervisores). */
export function makeIlha(id: string, supervisors: string | readonly string[], tenantId: TenantId = T1): Ilha {
  return { id: iid(id), tenantId, name: id, supervisorIds: (typeof supervisors === 'string' ? [supervisors] : supervisors).map(uid) };
}

/** Empresa T1: admin, 2 supervisores (uma ilha cada) e 4 agentes, cada um numa ilha só (o caso 1:1, que continua válido no N:N). */
export function seedDirectory(tenantId: TenantId = T1): Directory {
  const suffix = tenantId === T1 ? '' : '-b';
  const id = (name: string) => `${name}${suffix}`;
  return makeDirectory(
    tenantId,
    [
      makeUser('admin', id('admin'), { tenantId }),
      makeUser('supervisor', id('sup-1'), { tenantId }),
      makeUser('supervisor', id('sup-2'), { tenantId }),
      makeUser('agent', id('ag-1'), { tenantId, ilhaIds: [iid(id('ilha-1'))] }),
      makeUser('agent', id('ag-2'), { tenantId, ilhaIds: [iid(id('ilha-1'))] }),
      makeUser('agent', id('ag-3'), { tenantId, ilhaIds: [iid(id('ilha-2'))] }),
      makeUser('agent', id('ag-4'), { tenantId, ilhaIds: [iid(id('ilha-2'))] }),
    ],
    [makeIlha(id('ilha-1'), id('sup-1'), tenantId), makeIlha(id('ilha-2'), id('sup-2'), tenantId)],
  );
}

/**
 * Empresa N:N: o seed 1:1 mais
 * - `ilha-3`, com DOIS supervisores (`sup-1` e `sup-2`);
 * - `ag-5`, em `ilha-1` (sup-1) E `ilha-2` (sup-2): supervisores diferentes;
 * - `ag-6`, só em `ilha-3`;
 * - `ag-7`, em `ilha-1` e `ilha-3`: os dois supervisores se sobrepõem em `ilha-3`.
 */
export function seedDirectoryNN(tenantId: TenantId = T1): Directory {
  const base = seedDirectory(tenantId);
  const suffix = tenantId === T1 ? '' : '-b';
  const id = (name: string) => `${name}${suffix}`;
  const extra = [
    makeUser('agent', id('ag-5'), { tenantId, ilhaIds: [iid(id('ilha-1')), iid(id('ilha-2'))] }),
    makeUser('agent', id('ag-6'), { tenantId, ilhaIds: [iid(id('ilha-3'))] }),
    makeUser('agent', id('ag-7'), { tenantId, ilhaIds: [iid(id('ilha-1')), iid(id('ilha-3'))] }),
  ];
  return makeDirectory(
    tenantId,
    [...Object.values(base.users), ...extra],
    [...Object.values(base.ilhas), makeIlha(id('ilha-3'), [id('sup-1'), id('sup-2')], tenantId)],
  );
}

export function user(d: Directory, id: string): StaffUser {
  const found = d.users[uid(id)];
  if (!found) {
    throw new Error(`usuário ausente no fixture: ${id}`);
  }
  return found;
}

