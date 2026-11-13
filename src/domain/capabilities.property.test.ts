import fc from 'fast-check';
import { iid, makeDirectory, makeUser, seedDirectory, T1, T2, uid } from '../test/domainFixtures';
import {
  CAPABILITIES,
  ROLE_CEILING,
  ROLE_RANK,
  canAssignRole,
  canGrant,
  canRevoke,
  type Capability,
} from './capabilities';
import { applyAssignRole, applyCreate, applyGrant, applyRevoke } from './directoryOps';
import { validateDirectory, type Directory, type StaffUser } from './identity';
import { can } from './permissions';

const roleArb = fc.constantFrom(...(['admin', 'supervisor', 'agent'] as const));
const capabilityArb = fc.constantFrom(...CAPABILITIES);
const tenantArb = fc.constantFrom(T1, T2);
const grantsArb = fc.subarray([...CAPABILITIES]);

const userArb: fc.Arbitrary<StaffUser> = fc
  .record({
    role: roleArb,
    id: fc.constantFrom('u1', 'u2', 'u3'),
    tenantId: tenantArb,
    active: fc.boolean(),
    grants: grantsArb,
  })
  .map(({ role, id, tenantId, active, grants }) => makeUser(role, id, { tenantId, active, grants }));

describe('P1 a P4: canGrant (qualquer grants, inclusive fora do teto)', () => {
  it('P1, sem autoconcessão', () => {
    fc.assert(
      fc.property(userArb, capabilityArb, (actor, capability) => {
        expect(canGrant(actor, actor, capability).ok).toBe(false);
        expect(canRevoke(actor, actor, capability).ok).toBe(false);
      }),
    );
  });

  it('P2, sem concessão sem posse', () => {
    fc.assert(
      fc.property(userArb, userArb, capabilityArb, (actor, target, capability) => {
        if (canGrant(actor, target, capability).ok) {
          expect(actor.grants.has(capability)).toBe(true);
        }
      }),
    );
  });

  it('P3, teto respeitado', () => {
    fc.assert(
      fc.property(userArb, userArb, capabilityArb, (actor, target, capability) => {
        if (canGrant(actor, target, capability).ok) {
          expect(ROLE_CEILING[target.role].has(capability)).toBe(true);
        }
      }),
    );
  });

  it('P4, hierarquia: o supervisor nunca concede a supervisor nem a admin', () => {
    fc.assert(
      fc.property(userArb, userArb, capabilityArb, (actor, target, capability) => {
        if (canGrant(actor, target, capability).ok) {
          expect(ROLE_RANK[actor.role]).toBeGreaterThan(ROLE_RANK[target.role]);
          expect(actor.role === 'supervisor' && target.role !== 'agent').toBe(false);
        }
      }),
    );
  });
});

describe('P7: hierarquia da role atribuída (grants arbitrários)', () => {
  it('canAssignRole ok implica ator admin ou role atribuída agent', () => {
    const targetArb = fc.oneof(
      userArb,
      tenantArb.map((tenantId) => ({ tenantId })),
    );
    fc.assert(
      fc.property(userArb, targetArb, fc.constantFrom(...(['supervisor', 'agent'] as const)), (actor, target, role) => {
        if (canAssignRole(actor, target, role).ok) {
          expect(actor.role === 'admin' || role === 'agent').toBe(true);
          expect(actor.active).toBe(true);
          expect(actor.tenantId).toBe(target.tenantId);
        }
      }),
      { numRuns: 1000 },
    );
  });
});

describe('P6: tenant', () => {
  it('tenant diferente: toda operação falha com cross-tenant', () => {
    fc.assert(
      fc.property(userArb, userArb, capabilityArb, fc.constantFrom(...(['supervisor', 'agent'] as const)), (actor, target, capability, role) => {
        fc.pre(actor.tenantId !== target.tenantId);
        expect(canGrant(actor, target, capability)).toEqual({ ok: false, error: 'cross-tenant' });
        expect(canRevoke(actor, target, capability)).toEqual({ ok: false, error: 'cross-tenant' });
        expect(canAssignRole(actor, target, role)).toEqual({ ok: false, error: 'cross-tenant' });
        expect(canAssignRole(actor, { tenantId: target.tenantId }, role)).toEqual({ ok: false, error: 'cross-tenant' });
        const d = makeDirectory(actor.tenantId, [actor], []);
        expect(can(actor, { type: 'grant', target, capability }, d)).toEqual({ ok: false, error: 'cross-tenant' });
        expect(can(actor, { type: 'assignRole', target, role }, d)).toEqual({ ok: false, error: 'cross-tenant' });
      }),
    );
  });
});

// P5: sequências de operações sobre o diretório, enviesadas para atores que podem agir.
const SEED_IDS = ['admin', 'sup-1', 'sup-2', 'ag-1', 'ag-2', 'ag-3', 'ag-4'];
const NEW_IDS = ['novo-1', 'novo-2', 'novo-3', 'novo-4'];

type Kind = 'grant' | 'revoke' | 'assign' | 'create';
type Op = {
  kind: Kind;
  actor: string;
  target: string;
  capability: Capability;
  role: 'supervisor' | 'agent';
  ilha: string;
};

const actorArb = fc.oneof(
  { weight: 4, arbitrary: fc.constantFrom('admin', 'sup-1', 'sup-2') },
  { weight: 1, arbitrary: fc.constantFrom(...SEED_IDS, ...NEW_IDS) },
);
const targetArb = fc.oneof(
  { weight: 4, arbitrary: fc.constantFrom('sup-1', 'sup-2', 'ag-1', 'ag-2', 'ag-3', 'ag-4', ...NEW_IDS) },
  { weight: 1, arbitrary: fc.constantFrom(...SEED_IDS, ...NEW_IDS) },
);
const opArb: fc.Arbitrary<Op> = fc.record({
  kind: fc.constantFrom<Kind>('grant', 'revoke', 'assign', 'create'),
  actor: actorArb,
  target: targetArb,
  capability: fc.oneof(
    { weight: 3, arbitrary: fc.constantFrom<Capability>('chat.use', 'group.manage', 'agents.manage', 'grants.manage') },
    { weight: 1, arbitrary: capabilityArb },
  ),
  role: fc.constantFrom(...(['supervisor', 'agent'] as const)),
  ilha: fc.constantFrom('ilha-1', 'ilha-2', 'ilha-inexistente'),
});

function step(d: Directory, op: Op): Directory | undefined {
  const actor = uid(op.actor);
  const target = uid(op.target);
  const result =
    op.kind === 'grant'
      ? applyGrant(d, actor, target, op.capability)
      : op.kind === 'revoke'
        ? applyRevoke(d, actor, target, op.capability)
        : op.kind === 'assign'
          ? applyAssignRole(d, actor, target, op.role, iid(op.ilha))
          : applyCreate(d, actor, { id: target, name: op.target, role: op.role, ilhaId: iid(op.ilha) });
  return result.ok ? result.value : undefined;
}

const idsWithRole = (d: Directory, role: StaffUser['role']) =>
  Object.values(d.users)
    .filter((u) => u.role === role)
    .map((u) => u.id)
    .sort();

describe('P5: fechamento sobre sequências de operações aceitas', () => {
  it('invariantes após cada operação aceita; mínimo de aceitas por tipo', () => {
    const accepted: Record<Kind, number> = { grant: 0, revoke: 0, assign: 0, create: 0 };
    fc.assert(
      fc.property(fc.array(opArb, { maxLength: 40 }), (ops) => {
        let d = seedDirectory();
        const admins = idsWithRole(d, 'admin');
        for (const op of ops) {
          const before = d;
          const next = step(d, op);
          if (!next) continue;
          accepted[op.kind] += 1;
          d = next;
          const actorId = uid(op.actor);
          // ninguém muda a própria role nem os próprios grants (registro do ator intacto)
          expect(next.users[actorId]?.role).toBe(before.users[actorId]?.role);
          expect(next.users[actorId]?.grants).toEqual(before.users[actorId]?.grants);
          expect(next.users[actorId]).toEqual(before.users[actorId]);
          if (op.kind !== 'create') {
            expect(op.actor).not.toBe(op.target);
          }
          // nenhum supervisor gera supervisor/admin (nem rebaixa): os conjuntos não mudam
          if (before.users[actorId]?.role === 'supervisor') {
            expect(idsWithRole(next, 'supervisor')).toEqual(idsWithRole(before, 'supervisor'));
            expect(idsWithRole(next, 'admin')).toEqual(idsWithRole(before, 'admin'));
          }
          expect(validateDirectory(d).ok).toBe(true);
        }
        expect(idsWithRole(d, 'admin')).toEqual(admins);
        for (const u of Object.values(d.users)) {
          expect(u.tenantId).toBe(T1);
          for (const capability of u.grants) {
            expect(ROLE_CEILING[u.role].has(capability)).toBe(true);
          }
          if (u.role === 'supervisor') {
            for (const forbidden of ['supervisors.manage', 'ilhas.manage', 'admin.console'] as const) {
              expect(u.grants.has(forbidden)).toBe(false);
            }
          }
        }
      }),
      { numRuns: 400 },
    );
    for (const kind of ['grant', 'revoke', 'assign', 'create'] as const) {
      expect(accepted[kind], `operações ${kind} aceitas`).toBeGreaterThanOrEqual(20);
    }
  });
});
