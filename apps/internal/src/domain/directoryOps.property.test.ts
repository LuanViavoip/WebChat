import fc from 'fast-check';
import { iid, makeDirectory, makeIlha, makeUser, seedDirectory, T1, T2, uid, user } from '../test/domainFixtures';
import { CAPABILITIES, ROLE_CEILING, type Capability } from './capabilities';
import {
  applyAssignRole,
  assignIlhaSupervisor,
  canConnect,
  createIlha,
  deactivateUser,
  grantCapability,
  moveAgent,
  reactivateUser,
  registerAgent,
  registerSupervisor,
  renameIlha,
  revokeCapability,
  type AdminResult,
  type AdminState,
  type OpDeps,
} from './directoryOps';
import { validateDirectory, type Directory, type StaffUser, type UserId } from './identity';

type Kind =
  | 'grant'
  | 'revoke'
  | 'deactivate'
  | 'reactivate'
  | 'registerSupervisor'
  | 'registerAgent'
  | 'createIlha'
  | 'renameIlha'
  | 'assignIlhaSupervisor'
  | 'moveAgent'
  | 'assignRole';

type Op = {
  kind: Kind;
  actor: string;
  target: string;
  ilha: string;
  ilhas: string[];
  capability: Capability;
  role: 'supervisor' | 'agent';
};

const KINDS: readonly Kind[] = [
  'grant', 'revoke', 'deactivate', 'reactivate', 'registerSupervisor', 'registerAgent',
  'createIlha', 'renameIlha', 'assignIlhaSupervisor', 'moveAgent', 'assignRole',
];

const SEEDED = ['admin', 'sup-1', 'sup-2', 'ag-1', 'ag-2', 'ag-3', 'ag-4'];
const CREATED = ['novo-1', 'novo-2', 'novo-3', 'novo-4', 'novo-5'];
// ids de outro tenant, forjados, inexistentes e de protótipo
const FORGED = ['admin-b', 'sup-1-b', 'ag-1-b', 'ilha-1-b', 'inexistente', '__proto__', 'constructor', ''];
const ALIENS = ['alien-admin', 'alien-sup', 'alien-ag'];
const ILHAS = ['ilha-1', 'ilha-2', 'ilha-novo-1', 'ilha-novo-2', 'ilha-novo-3', 'alien-ilha'];

const actorArb = fc.oneof(
  { weight: 5, arbitrary: fc.constantFrom('admin', 'sup-1', 'sup-2') },
  { weight: 2, arbitrary: fc.constantFrom(...SEEDED, ...CREATED) },
  { weight: 1, arbitrary: fc.constantFrom(...ALIENS, ...FORGED) },
);
const targetArb = fc.oneof(
  { weight: 3, arbitrary: fc.constantFrom('ag-1', 'ag-2', 'ag-3', 'ag-4', 'sup-1', 'sup-2', ...CREATED) },
  // alvos com lacunas no seed: há o que conceder
  { weight: 3, arbitrary: fc.constantFrom('ag-2', 'ag-4', 'sup-2') },
  { weight: 1, arbitrary: fc.constantFrom('admin') },
  { weight: 2, arbitrary: fc.constantFrom(...ALIENS, ...FORGED) },
);
const ilhaArb = fc.oneof(
  { weight: 6, arbitrary: fc.constantFrom(...ILHAS) },
  { weight: 1, arbitrary: fc.constantFrom('ilha-1-b', 'ilha-fantasma', '__proto__') },
);
const opArb: fc.Arbitrary<Op> = fc.record({
  kind: fc.constantFrom(...KINDS),
  actor: actorArb,
  target: targetArb,
  ilha: ilhaArb,
  ilhas: fc.array(ilhaArb, { maxLength: 2 }),
  capability: fc.oneof(
    { weight: 6, arbitrary: fc.constantFrom<Capability>('chat.use', 'group.manage', 'announcement.publish') },
    { weight: 2, arbitrary: fc.constantFrom<Capability>('agents.manage', 'grants.manage') },
    { weight: 1, arbitrary: fc.constantFrom(...CAPABILITIES) },
  ),
  role: fc.constantFrom('supervisor', 'agent'),
});

type Fixture = { state: AdminState; planted: boolean };

/** Seed com lacunas para haver o que conceder: agentes sem chat.use e um supervisor (sup-2) sem chat.use, grants.manage e duas outras. */
function seedWithGaps(): Directory {
  const seed = seedDirectory();
  const patch = (id: string, grants: readonly Capability[]): StaffUser => ({ ...user(seed, id), grants: new Set(grants) });
  const sup2 = user(seed, 'sup-2');
  return {
    ...seed,
    users: {
      ...seed.users,
      [uid('ag-2')]: patch('ag-2', []),
      [uid('ag-4')]: patch('ag-4', []),
      [uid('sup-2')]: { ...sup2, grants: new Set([...sup2.grants].filter((c) => !['group.manage', 'announcement.publish', 'chat.use', 'grants.manage'].includes(c))) },
    },
  };
}

function cleanState(): AdminState {
  return { directory: seedWithGaps(), grantLog: [] };
}

/** Planta registros de OUTRA empresa dentro do diretório (dado corrompido) para provar que nada os toca nem os usa. */
function plantedState(): AdminState {
  const base = seedWithGaps();
  const alien = [
    makeUser('admin', 'alien-admin', { tenantId: T2 }),
    makeUser('supervisor', 'alien-sup', { tenantId: T2 }),
    makeUser('agent', 'alien-ag', { tenantId: T2, ilhaId: iid('alien-ilha') }),
  ];
  const d = makeDirectory(T1, [...Object.values(base.users), ...alien], [...Object.values(base.ilhas), makeIlha('alien-ilha', 'alien-sup', T2)]);
  return { directory: d, grantLog: [] };
}

function ser(user: StaffUser | undefined): unknown {
  return user ? { ...user, grants: [...user.grants].sort() } : undefined;
}
function snapshot(d: Directory): string {
  return JSON.stringify({
    t: d.tenantId,
    users: Object.keys(d.users).sort().map((id) => ser(d.users[uid(id)])),
    ilhas: Object.keys(d.ilhas).sort().map((id) => d.ilhas[iid(id)]),
  });
}

function makeDeps(): OpDeps & { consumed: () => string } {
  let n = 0;
  let u = 0;
  let i = 0;
  return {
    consumed: () => `${String(n)}/${String(u)}/${String(i)}`, now: () => `t-${String(++n)}`,
    newUserId: () => uid(`novo-${String(++u)}`),
    newIlhaId: () => iid(`ilha-novo-${String(++i)}`), };
}

function apply(state: AdminState, op: Op, deps: OpDeps): AdminResult {
  const actor = uid(op.actor);
  const target = uid(op.target);
  switch (op.kind) {
    case 'grant':
      return grantCapability(state, actor, target, op.capability, deps);
    case 'revoke':
      return revokeCapability(state, actor, target, op.capability, deps);
    case 'deactivate':
      return deactivateUser(state, actor, target);
    case 'reactivate':
      return reactivateUser(state, actor, target);
    case 'registerSupervisor':
      return registerSupervisor(state, actor, { name: 'Sup', ilhaIds: op.ilhas.map(iid) }, deps);
    case 'registerAgent':
      return registerAgent(state, actor, { name: 'Ag', ilhaId: iid(op.ilha) }, deps);
    case 'createIlha':
      return createIlha(state, actor, { name: 'Nova', supervisorId: target }, deps);
    case 'renameIlha':
      return renameIlha(state, actor, iid(op.ilha), `Ilha ${op.target}`);
    case 'assignIlhaSupervisor':
      return assignIlhaSupervisor(state, actor, iid(op.ilha), target);
    case 'moveAgent':
      return moveAgent(state, actor, target, iid(op.ilha));
    case 'assignRole': {
      const r = applyAssignRole(state.directory, actor, target, op.role, iid(op.ilha));
      return r.ok ? { ok: true, value: { ...state, directory: r.value } } : r;
    }
  }
}

/** Só os campos que a operação realmente usa. */
function referencesAlien(op: Op): boolean {
  const target = ALIENS.includes(op.target);
  const ilha = op.ilha === 'alien-ilha';
  switch (op.kind) {
    case 'grant':
    case 'revoke':
    case 'deactivate':
    case 'reactivate':
    case 'createIlha':
      return target;
    case 'registerSupervisor':
      return op.ilhas.includes('alien-ilha');
    case 'registerAgent':
    case 'renameIlha':
      return ilha;
    case 'assignIlhaSupervisor':
    case 'moveAgent':
      return target || ilha;
    case 'assignRole':
      return target || (op.role === 'agent' && ilha); // a ilha só conta para a role agent
  }
}

type Stats = Record<string, number>;
const bump = (stats: Stats, key: string): void => {
  stats[key] = (stats[key] ?? 0) + 1;
};

function userIds(d: Directory): string[] {
  return [...new Set(Object.keys(d.users))].sort();
}

/** Roda a sequência e lança (expect) se algum invariante cair. Devolve o estado final. */
function runSequence(ops: readonly Op[], fixture: Fixture, stats: Stats): AdminState {
  let state = fixture.state;
  const deps = makeDeps();
  // "dado" do admin: tudo que cada supervisor pode ter recebido do admin
  const given = new Map<UserId, Set<Capability>>();
  for (const u of Object.values(state.directory.users)) {
    if (u.role === 'supervisor' && u.tenantId === T1) given.set(u.id, new Set(u.grants));
  }

  for (const op of ops) {
    const before = state;
    const beforeSnap = snapshot(before.directory);
    const actorBefore = before.directory.users[uid(op.actor)];
    const isAlienActor = ALIENS.includes(op.actor);
    const touchesAlien = referencesAlien(op);
    const consumedBefore = deps.consumed();
    const result = apply(before, op, deps);

    // pureza: a entrada nunca é mutada, aceita ou negada
    expect(snapshot(before.directory)).toBe(beforeSnap);

    if (!result.ok) {
      bump(stats, `${op.kind}:negada`);
      if (result.error === 'outside-islands') bump(stats, 'negada:outside-islands');
      if (result.error === 'cross-tenant') bump(stats, 'negada:cross-tenant');
      // negada por autorização/validação não consome id nem relógio (só colisão de id pode)
      if (result.error !== 'duplicate-user' && result.error !== 'duplicate-ilha') {
        expect(deps.consumed()).toBe(consumedBefore);
      }
      if (isAlienActor) bump(stats, 'alien-ator-negado');
      if (FORGED.includes(op.target) || FORGED.includes(op.actor)) bump(stats, 'forjado-negado');
      continue;
    }

    bump(stats, `${op.kind}:aceita`);
    const after = result.value;
    // ator existente, do tenant, ativo, e nunca um registro de outra empresa
    expect(actorBefore).toBeDefined();
    expect(actorBefore?.active).toBe(true);
    expect(actorBefore?.tenantId).toBe(T1);
    expect(isAlienActor).toBe(false);
    expect(FORGED.includes(op.actor)).toBe(false);
    // o ator nunca altera o próprio registro
    expect(ser(after.directory.users[uid(op.actor)])).toEqual(ser(actorBefore));
    // aliens e seus ids intocados; nenhuma operação aceita os referencia
    if (fixture.planted) {
      // nenhuma operação aceita referencia (como alvo, ilha ou supervisor) um registro de outra empresa
      expect(touchesAlien).toBe(false);
      for (const id of ALIENS) {
        expect(ser(after.directory.users[uid(id)])).toEqual(ser(before.directory.users[uid(id)]));
      }
      expect(after.directory.ilhas[iid('alien-ilha')]).toEqual(before.directory.ilhas[iid('alien-ilha')]);
    }
    // nada muda de tenant e ninguém de outro tenant entra
    const planted = fixture.planted ? ALIENS : [];
    for (const u of Object.values(after.directory.users)) {
      if (!planted.includes(u.id)) expect(u.tenantId).toBe(T1);
    }
    for (const ilha of Object.values(after.directory.ilhas)) {
      if (ilha.id !== iid('alien-ilha')) expect(ilha.tenantId).toBe(T1);
    }
    // exatamente um admin do tenant
    expect(Object.values(after.directory.users).filter((u) => u.role === 'admin' && u.tenantId === T1)).toHaveLength(1);
    // desativado não conecta; ativo do tenant conecta
    for (const u of Object.values(after.directory.users)) {
      expect(canConnect(after.directory, u.id)).toBe(u.active && u.tenantId === T1);
    }
    expect(canConnect(after.directory, uid('ag-1-b'))).toBe(false);
    if (!fixture.planted) expect(validateDirectory(after.directory).ok).toBe(true);

    const actorRole = actorBefore?.role;
    // roles: só o admin muda role de alguém; supervisor nunca gera supervisor/admin
    for (const id of userIds(before.directory)) {
      const b = before.directory.users[uid(id)];
      const a = after.directory.users[uid(id)];
      expect(a).toBeDefined();
      if (actorRole !== 'admin') expect(a?.role).toBe(b?.role);
    }
    if (actorRole === 'supervisor') {
      bump(stats, 'supervisor-aceita');
      const sup = uid(op.actor);
      // escopo calculado independente do código sob teste
      const own = new Set(Object.values(before.directory.ilhas).filter((i) => i.supervisorId === sup).map((i) => String(i.id)));
      expect(own.size).toBeGreaterThan(0);
      expect(JSON.stringify(after.directory.ilhas)).toBe(JSON.stringify(before.directory.ilhas));
      for (const id of userIds(after.directory)) {
        const b = before.directory.users[uid(id)];
        const a = after.directory.users[uid(id)];
        if (JSON.stringify(ser(a)) === JSON.stringify(ser(b))) continue;
        bump(stats, 'supervisor-mexeu-em-agente');
        expect(a?.role).toBe('agent');
        expect(a?.tenantId).toBe(T1);
        if (a?.role === 'agent') expect(own.has(a.ilhaId)).toBe(true);
        if (b) {
          expect(b.role).toBe('agent');
          if (b.role === 'agent') expect(own.has(b.ilhaId)).toBe(true);
        }
      }
    }
    // supervisor só tem capacidade que o admin lhe deu
    if (actorRole === 'admin') {
      for (const u of Object.values(after.directory.users)) {
        if (u.role === 'supervisor') given.set(u.id, new Set([...(given.get(u.id) ?? []), ...u.grants]));
      }
    }
    for (const u of Object.values(after.directory.users)) {
      if (u.role !== 'supervisor' || u.tenantId !== T1) continue;
      const allowed = given.get(u.id) ?? new Set<Capability>();
      for (const capability of u.grants) {
        expect(allowed.has(capability)).toBe(true);
      }
    }

    // grants de um usuário existente só mudam por grant/revoke aceito (com log) ou, pelo admin,
    // numa troca de role que apenas CORTA (nunca ganha)
    for (const id of userIds(before.directory)) {
      const b = before.directory.users[uid(id)];
      const a = after.directory.users[uid(id)];
      if (!a || !b || [...a.grants].sort().join() === [...b.grants].sort().join()) continue;
      const viaLog = (op.kind === 'grant' || op.kind === 'revoke') && op.target === id;
      const viaRoleCut = op.kind === 'assignRole' && op.target === id && actorBefore?.role === 'admin' && [...a.grants].every((c) => b.grants.has(c));
      expect(viaLog || viaRoleCut, `grants de ${id} mudaram sem grant/revoke`).toBe(true);
    }
    // usuário recém-cadastrado: grants ⊆ (grants do ator ∩ teto do ator) ∩ teto da role nova
    for (const id of userIds(after.directory)) {
      const created = after.directory.users[uid(id)];
      if (before.directory.users[uid(id)] || !created || !actorBefore) continue;
      bump(stats, 'cadastro-aceito');
      for (const capability of created.grants) {
        expect(actorBefore.grants.has(capability) && ROLE_CEILING[actorBefore.role].has(capability)).toBe(true);
        expect(ROLE_CEILING[created.role].has(capability)).toBe(true);
      }
      if (actorBefore.role === 'supervisor' && !actorBefore.grants.has('chat.use')) {
        bump(stats, 'cadastro-por-supervisor-sem-chat');
        expect(created.grants.has('chat.use')).toBe(false);
      }
    }
    // grantLog: só cresce em grant/revoke aceito, 1 entrada, correspondendo a mudança real
    if (op.kind === 'grant' || op.kind === 'revoke') {
      expect(after.grantLog).toHaveLength(before.grantLog.length + 1);
      expect(after.grantLog.slice(0, before.grantLog.length)).toEqual(before.grantLog);
      const entry = after.grantLog[after.grantLog.length - 1];
      expect(entry).toEqual({
        tenantId: T1,
        actorId: op.actor,
        targetId: op.target,
        capability: op.capability,
        granted: op.kind === 'grant',
        at: `t-${String(after.grantLog.length)}`,
      });
      const b = before.directory.users[uid(op.target)];
      const a = after.directory.users[uid(op.target)];
      expect(b?.grants.has(op.capability)).toBe(op.kind === 'revoke');
      expect(a?.grants.has(op.capability)).toBe(op.kind === 'grant');
      // só o alvo mudou
      for (const id of userIds(before.directory)) {
        if (id !== op.target) expect(ser(after.directory.users[uid(id)])).toEqual(ser(before.directory.users[uid(id)]));
      }
    } else {
      expect(after.grantLog).toBe(before.grantLog);
    }
    // toda operação aceita de AdminState muda algo de verdade (assignRole, do diretório, é idempotente)
    if (op.kind !== 'assignRole') expect(snapshot(after.directory)).not.toBe(beforeSnap);
    state = after;
  }
  return state;
}

describe('propriedades do console de administração (sequências arbitrárias)', () => {
  it('invariantes valem em diretório limpo', () => {
    fc.assert(
      fc.property(fc.array(opArb, { minLength: 10, maxLength: 40 }), (ops) => {
        runSequence(ops, { state: cleanState(), planted: false }, {});
      }),
      { numRuns: 300 },
    );
  });

  it('invariantes valem com registros de outra empresa plantados no diretório', () => {
    fc.assert(
      fc.property(fc.array(opArb, { minLength: 10, maxLength: 40 }), (ops) => {
        runSequence(ops, { state: plantedState(), planted: true }, {});
      }),
      { numRuns: 300 },
    );
  });

  it('cobertura (seed fixa): as sequências geram operações aceitas E negadas de cada tipo', () => {
    const stats: Stats = {};
    fc.assert(
      fc.property(fc.array(opArb, { minLength: 10, maxLength: 40 }), (ops) => {
        runSequence(ops, { state: plantedState(), planted: true }, stats);
      }),
      { numRuns: 500, seed: 20260101 },
    );
    for (const kind of KINDS) {
      expect(stats[`${kind}:aceita`] ?? 0, `${kind} aceitas`).toBeGreaterThanOrEqual(5);
      expect(stats[`${kind}:negada`] ?? 0, `${kind} negadas`).toBeGreaterThanOrEqual(15);
    }
    expect(stats['cadastro-aceito'] ?? 0).toBeGreaterThanOrEqual(30);
    expect(stats['cadastro-por-supervisor-sem-chat'] ?? 0).toBeGreaterThanOrEqual(3);
    expect(stats['supervisor-aceita'] ?? 0).toBeGreaterThanOrEqual(100);
    expect(stats['supervisor-mexeu-em-agente'] ?? 0).toBeGreaterThanOrEqual(50);
    expect(stats['negada:outside-islands'] ?? 0).toBeGreaterThanOrEqual(50);
    expect(stats['negada:cross-tenant'] ?? 0).toBeGreaterThanOrEqual(50);
    expect(stats['alien-ator-negado'] ?? 0).toBeGreaterThanOrEqual(20);
    expect(stats['forjado-negado'] ?? 0).toBeGreaterThanOrEqual(50);
  });
});
