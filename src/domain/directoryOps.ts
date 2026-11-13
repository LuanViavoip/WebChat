import {
  canAssignRole,
  canGrant,
  canRevoke,
  effectiveGrants,
  grantsAfterRoleChange,
  type AssignableRole,
  type Capability,
  type GrantDenial,
  type RoleDenial,
} from './capabilities';
import type { Agent, Directory, IlhaId, StaffUser, UserId } from './identity';
import { own } from './records';
import { err, ok, type Result } from './result';

export type OpError =
  | GrantDenial
  | RoleDenial
  | 'unknown-actor'
  | 'unknown-target'
  | 'duplicate-user'
  | 'ilha-required'
  | 'unknown-ilha'
  | 'supervises-ilha';

type OpResult = Result<Directory, OpError>;

function withUser(d: Directory, user: StaffUser): Directory {
  return { ...d, users: { ...d.users, [user.id]: user } };
}

function lookup(d: Directory, actorId: UserId, targetId: UserId): Result<{ actor: StaffUser; target: StaffUser }, OpError> {
  const actor = own(d.users, actorId);
  if (!actor) {
    return err('unknown-actor');
  }
  const target = own(d.users, targetId);
  if (!target) {
    return err('unknown-target');
  }
  return ok({ actor, target });
}

/** Aplica um grant validado por `canGrant`: as mesmas regras que o MockServer usa. */
export function applyGrant(d: Directory, actorId: UserId, targetId: UserId, capability: Capability): OpResult {
  const found = lookup(d, actorId, targetId);
  if (!found.ok) {
    return found;
  }
  const { actor, target } = found.value;
  const verdict = canGrant(actor, target, capability);
  if (!verdict.ok) {
    return verdict;
  }
  return ok(withUser(d, { ...target, grants: new Set([...target.grants, capability]) }));
}

export function applyRevoke(d: Directory, actorId: UserId, targetId: UserId, capability: Capability): OpResult {
  const found = lookup(d, actorId, targetId);
  if (!found.ok) {
    return found;
  }
  const { actor, target } = found.value;
  const verdict = canRevoke(actor, target, capability);
  if (!verdict.ok) {
    return verdict;
  }
  return ok(withUser(d, { ...target, grants: new Set([...target.grants].filter((item) => item !== capability)) }));
}

/** Grants após cadastro/mudança de role: padrão da role ∩ teto ∩ o que o ator tem (ninguém dá o que não tem). */
function initialGrants(actor: StaffUser, role: AssignableRole): ReadonlySet<Capability> {
  const held = effectiveGrants(actor);
  return new Set([...grantsAfterRoleChange(role)].filter((capability) => held.has(capability)));
}

function build(
  base: { id: UserId; tenantId: Directory['tenantId']; name: string; active: boolean },
  actor: StaffUser,
  role: AssignableRole,
  ilhaId: IlhaId | undefined,
  d: Directory,
): Result<StaffUser, OpError> {
  const grants = initialGrants(actor, role);
  if (role === 'supervisor') {
    return ok({ ...base, role, grants });
  }
  if (!ilhaId) {
    return err('ilha-required');
  }
  const ilha = own(d.ilhas, ilhaId);
  const supervisor = ilha ? own(d.users, ilha.supervisorId) : undefined;
  // A ilha precisa existir de verdade, ser do tenant e ter um supervisor válido do mesmo tenant.
  if (
    !ilha ||
    ilha.tenantId !== d.tenantId ||
    supervisor?.role !== 'supervisor' ||
    supervisor.tenantId !== d.tenantId
  ) {
    return err('unknown-ilha');
  }
  const agent: Agent = { ...base, role, grants, ilhaId };
  return ok(agent);
}

/** Muda a role de alguém. Agente exige `ilhaId`; rebaixar quem supervisiona uma ilha é recusado. */
export function applyAssignRole(
  d: Directory,
  actorId: UserId,
  targetId: UserId,
  role: AssignableRole,
  ilhaId?: IlhaId,
): OpResult {
  const found = lookup(d, actorId, targetId);
  if (!found.ok) {
    return found;
  }
  const { actor, target } = found.value;
  const verdict = canAssignRole(actor, target, role);
  if (!verdict.ok) {
    return verdict;
  }
  if (
    role !== 'supervisor' &&
    target.role === 'supervisor' &&
    Object.values(d.ilhas).some((ilha) => ilha.supervisorId === target.id)
  ) {
    return err('supervises-ilha');
  }
  const next = build(
    { id: target.id, tenantId: target.tenantId, name: target.name, active: target.active },
    actor,
    role,
    ilhaId,
    d,
  );
  return next.ok ? ok(withUser(d, next.value)) : next;
}

export type NewUser = {
  readonly id: UserId;
  readonly name: string;
  readonly role: AssignableRole;
  readonly ilhaId?: IlhaId;
};

export function applyCreate(d: Directory, actorId: UserId, input: NewUser): OpResult {
  const actor = own(d.users, actorId);
  if (!actor) {
    return err('unknown-actor');
  }
  const verdict = canAssignRole(actor, { tenantId: d.tenantId }, input.role);
  if (!verdict.ok) {
    return verdict;
  }
  if (own(d.users, input.id) !== undefined) {
    return err('duplicate-user');
  }
  const next = build({ id: input.id, tenantId: d.tenantId, name: input.name, active: true }, actor, input.role, input.ilhaId, d);
  return next.ok ? ok(withUser(d, next.value)) : next;
}
