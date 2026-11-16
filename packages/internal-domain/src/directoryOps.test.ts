import { iid, makeIlha, makeUser, seedDirectory, T1, uid, user } from './testing/domainFixtures';
import { GRANT_DENIAL_TEXT, canGrantIn, canRevokeIn, type Capability } from './capabilities';
import {
  DENIAL_TEXT,
  applyAssignRole,
  applyCreate,
  assignIlhaSupervisor,
  canConnect,
  canManageIlhasIn,
  canMoveAgentIn,
  canRegisterAgentIn,
  canRegisterSupervisorIn,
  canSetActiveIn,
  describeDenial,
  validName,
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
import { validateDirectory, type Directory, type StaffUser } from './identity';

function makeDeps(): OpDeps & { calls: () => number } {
  let n = 0;
  let u = 0;
  let i = 0;
  return {
    now: () => `t-${String(++n)}`,
    newUserId: () => uid(`novo-${String(++u)}`),
    newIlhaId: () => iid(`ilha-novo-${String(++i)}`),
    calls: () => n,
  };
}

/** Diretório da matriz: seed + ilha-1b (de sup-1) + agente numa ilha inexistente. */
function baseDirectory(map: (u: StaffUser) => StaffUser = (u) => u): Directory {
  const seed = seedDirectory();
  const users: Record<string, StaffUser> = {
    ...seed.users,
    [uid('ag-sem')]: makeUser('agent', 'ag-sem', { ilhaId: iid('ilha-fantasma') }),
  };
  return {
    ...seed,
    users: Object.fromEntries(Object.values(users).map((u) => [u.id, map(u)])),
    ilhas: { ...seed.ilhas, [iid('ilha-1b')]: makeIlha('ilha-1b', 'sup-1') },
  };
}

const withGrants = (grants: readonly Capability[]) => (u: StaffUser): StaffUser =>
  u.role === 'agent' ? { ...u, grants: new Set(grants) } : u;
const withActive = (active: boolean, except: string) => (u: StaffUser): StaffUser =>
  u.role === 'agent' && u.id !== except ? { ...u, active } : u;

type TargetKind = 'própria ilha' | 'outra ilha' | 'sem ilha' | 'outro tenant' | 'ele mesmo';
const TARGET_ID: Record<'admin' | 'supervisor' | 'agent', Record<TargetKind, string>> = {
  admin: { 'própria ilha': 'ag-1', 'outra ilha': 'ag-3', 'sem ilha': 'ag-sem', 'outro tenant': 'ag-1-b', 'ele mesmo': 'admin' },
  supervisor: { 'própria ilha': 'ag-1', 'outra ilha': 'ag-3', 'sem ilha': 'ag-sem', 'outro tenant': 'ag-1-b', 'ele mesmo': 'sup-1' },
  agent: { 'própria ilha': 'ag-2', 'outra ilha': 'ag-3', 'sem ilha': 'ag-sem', 'outro tenant': 'ag-1-b', 'ele mesmo': 'ag-1' },
};
const ACTOR_ID = { admin: 'admin', supervisor: 'sup-1', agent: 'ag-1' } as const;
const KINDS: readonly TargetKind[] = ['própria ilha', 'outra ilha', 'sem ilha', 'outro tenant', 'ele mesmo'];

type TargetOp = 'grant' | 'revoke' | 'deactivate' | 'reactivate' | 'move';
const OPS: readonly TargetOp[] = ['grant', 'revoke', 'deactivate', 'reactivate', 'move'];

function stateFor(op: TargetOp, actorId = 'admin'): AdminState {
  const map =
    op === 'grant' ? withGrants([]) : op === 'revoke' ? withGrants(['chat.use']) : op === 'reactivate' ? withActive(false, actorId) : (u: StaffUser) => u;
  return { directory: baseDirectory(map), grantLog: [] };
}

function run(op: TargetOp, role: 'admin' | 'supervisor' | 'agent', targetId: string): AdminResult {
  const state = stateFor(op, ACTOR_ID[role]);
  const actor = uid(ACTOR_ID[role]);
  const target = uid(targetId);
  const deps = makeDeps();
  switch (op) {
    case 'grant':
      return grantCapability(state, actor, target, 'chat.use', deps);
    case 'revoke':
      return revokeCapability(state, actor, target, 'chat.use', deps);
    case 'deactivate':
      return deactivateUser(state, actor, target);
    case 'reactivate':
      return reactivateUser(state, actor, target);
    case 'move':
      return moveAgent(state, actor, target, iid('ilha-1b'));
  }
}

/** Esperado ESCRITO À MÃO. Chave: ator | tipo de alvo. */
function expected(op: TargetOp, role: 'admin' | 'supervisor' | 'agent', kind: TargetKind): string {
  if (kind === 'outro tenant') return 'cross-tenant';
  if (kind === 'ele mesmo') return 'self';
  if (role === 'agent') return op === 'grant' || op === 'revoke' ? 'no-grants-manage' : 'no-manage-capability';
  if (role === 'admin') return 'ok';
  return kind === 'própria ilha' ? 'ok' : 'outside-islands';
}

const outcome = (r: AdminResult): string => (r.ok ? 'ok' : r.error);

describe('escopo de ilha: ator x alvo x operação (motivo exato)', () => {
  for (const op of OPS) {
    for (const role of ['admin', 'supervisor', 'agent'] as const) {
      for (const kind of KINDS) {
        it(`${op}: ${role} sobre ${kind}`, () => {
          expect(outcome(run(op, role, TARGET_ID[role][kind]))).toBe(expected(op, role, kind));
        });
      }
    }
  }

  it('a matriz tem aceitas e negadas de cada motivo (não é vacua)', () => {
    const seen = new Set<string>();
    for (const op of OPS) {
      for (const role of ['admin', 'supervisor', 'agent'] as const) {
        for (const kind of KINDS) {
          seen.add(outcome(run(op, role, TARGET_ID[role][kind])));
        }
      }
    }
    expect([...seen].sort()).toEqual(['cross-tenant', 'no-grants-manage', 'no-manage-capability', 'ok', 'outside-islands', 'self']);
  });

  it('mover: o supervisor precisa ser dono da origem E do destino', () => {
    const state = stateFor('move');
    const deps = makeDeps();
    // origem dele, destino de outro supervisor
    expect(outcome(moveAgent(state, uid('sup-1'), uid('ag-1'), iid('ilha-2')))).toBe('outside-islands');
    // origem de outro, destino dele
    expect(outcome(moveAgent(state, uid('sup-1'), uid('ag-3'), iid('ilha-1')))).toBe('outside-islands');
    // destino inexistente / de outro tenant
    expect(outcome(moveAgent(state, uid('sup-1'), uid('ag-1'), iid('ilha-fantasma')))).toBe('unknown-ilha');
    expect(outcome(moveAgent(state, uid('sup-1'), uid('ag-1'), iid('ilha-1-b')))).toBe('unknown-ilha');
    // mesma ilha
    expect(outcome(moveAgent(state, uid('sup-1'), uid('ag-1'), iid('ilha-1')))).toBe('no-change');
    // admin: qualquer ilha da empresa
    const moved = moveAgent(state, uid('admin'), uid('ag-1'), iid('ilha-2'));
    expect(moved.ok && moved.value.directory.users[uid('ag-1')]).toMatchObject({ ilhaId: 'ilha-2' });
    expect(deps.calls()).toBe(0);
  });

  it('mover não mexe em supervisor nem em admin', () => {
    const state = stateFor('move');
    expect(outcome(moveAgent(state, uid('admin'), uid('sup-2'), iid('ilha-1')))).toBe('target-not-agent');
    expect(outcome(moveAgent(state, uid('sup-1'), uid('sup-2'), iid('ilha-1')))).toBe('no-manage-capability');
    expect(outcome(moveAgent(state, uid('sup-1'), uid('admin'), iid('ilha-1')))).toBe('not-higher-rank');
  });

  it('ninguém desativa o admin; ninguém desativa a si mesmo', () => {
    const state = stateFor('deactivate');
    expect(outcome(deactivateUser(state, uid('sup-1'), uid('admin')))).toBe('not-higher-rank');
    expect(outcome(deactivateUser(state, uid('ag-1'), uid('admin')))).toBe('not-higher-rank');
    expect(outcome(deactivateUser(state, uid('admin'), uid('admin')))).toBe('self');
    expect(outcome(deactivateUser(state, uid('sup-1'), uid('sup-1')))).toBe('self');
  });

  it('supervisor não desativa supervisor; admin desativa supervisor', () => {
    const state = stateFor('deactivate');
    expect(outcome(deactivateUser(state, uid('sup-1'), uid('sup-2')))).toBe('no-manage-capability');
    expect(outcome(deactivateUser(state, uid('admin'), uid('sup-2')))).toBe('ok');
  });
});

describe('cadastros e ilhas', () => {
  // seed limpo (sem o agente órfão da matriz), para validateDirectory valer
  const state: AdminState = { directory: { ...baseDirectory(), users: seedDirectory().users }, grantLog: [] };
  const roles = { admin: 'admin', supervisor: 'sup-1', agent: 'ag-1' } as const;

  it('cadastrar agente: admin em qualquer ilha da empresa; supervisor só em ilha dele', () => {
    const table: Record<string, Record<string, string>> = {
      admin: { 'ilha-1': 'ok', 'ilha-2': 'ok', 'ilha-fantasma': 'unknown-ilha', 'ilha-1-b': 'unknown-ilha' },
      supervisor: { 'ilha-1': 'ok', 'ilha-2': 'outside-islands', 'ilha-fantasma': 'unknown-ilha', 'ilha-1-b': 'unknown-ilha' },
      agent: { 'ilha-1': 'no-manage-capability', 'ilha-2': 'no-manage-capability', 'ilha-fantasma': 'no-manage-capability', 'ilha-1-b': 'no-manage-capability' },
    };
    for (const role of ['admin', 'supervisor', 'agent'] as const) {
      const row = table[role] ?? {};
      for (const [ilha, want] of Object.entries(row)) {
        const got = registerAgent(state, uid(roles[role]), { name: 'Novo', ilhaId: iid(ilha) }, makeDeps());
        expect(`${role}/${ilha}: ${outcome(got)}`).toBe(`${role}/${ilha}: ${want}`);
      }
    }
  });

  it('cadastrar agente: nome em branco, id duplicado e resultado', () => {
    expect(outcome(registerAgent(state, uid('admin'), { name: '   ', ilhaId: iid('ilha-1') }, makeDeps()))).toBe('invalid-name');
    const dup = { ...makeDeps(), newUserId: () => uid('ag-1') };
    expect(outcome(registerAgent(state, uid('admin'), { name: 'X', ilhaId: iid('ilha-1') }, dup))).toBe('duplicate-user');
    const done = registerAgent(state, uid('sup-1'), { name: '  Ana ', ilhaId: iid('ilha-1') }, makeDeps());
    expect(done.ok).toBe(true);
    if (done.ok) {
      expect(user(done.value.directory, 'novo-1')).toMatchObject({ role: 'agent', name: 'Ana', active: true, ilhaId: 'ilha-1' });
      expect(done.value.grantLog).toEqual([]);
      expect(validateDirectory(done.value.directory).ok).toBe(true);
    }
  });

  it('cadastrar supervisor: só o admin; leva as ilhas pedidas', () => {
    expect(outcome(registerSupervisor(state, uid('sup-1'), { name: 'P', ilhaIds: [] }, makeDeps()))).toBe('no-manage-capability');
    expect(outcome(registerSupervisor(state, uid('ag-1'), { name: 'P', ilhaIds: [] }, makeDeps()))).toBe('no-manage-capability');
    expect(outcome(registerSupervisor(state, uid('admin'), { name: ' ', ilhaIds: [] }, makeDeps()))).toBe('invalid-name');
    expect(outcome(registerSupervisor(state, uid('admin'), { name: 'P', ilhaIds: [iid('ilha-1-b')] }, makeDeps()))).toBe('unknown-ilha');
    const done = registerSupervisor(state, uid('admin'), { name: 'Paula', ilhaIds: [iid('ilha-2'), iid('ilha-2')] }, makeDeps());
    expect(done.ok).toBe(true);
    if (done.ok) {
      const paula = user(done.value.directory, 'novo-1');
      expect(paula.role).toBe('supervisor');
      expect(done.value.directory.ilhas[iid('ilha-2')]?.supervisorId).toBe('novo-1');
      expect(done.value.directory.ilhas[iid('ilha-1')]?.supervisorId).toBe('sup-1');
      expect(validateDirectory(done.value.directory).ok).toBe(true);
    }
  });

  it('criar, renomear e atribuir supervisor à ilha: só o admin', () => {
    for (const who of ['sup-1', 'ag-1']) {
      expect(outcome(createIlha(state, uid(who), { name: 'Sul', supervisorId: uid('sup-1') }, makeDeps()))).toBe('no-manage-capability');
      expect(outcome(renameIlha(state, uid(who), iid('ilha-1'), 'Sul'))).toBe('no-manage-capability');
      expect(outcome(assignIlhaSupervisor(state, uid(who), iid('ilha-1'), uid('sup-2')))).toBe('no-manage-capability');
    }
    const created = createIlha(state, uid('admin'), { name: ' Sul ', supervisorId: uid('sup-2') }, makeDeps());
    expect(created.ok && created.value.directory.ilhas[iid('ilha-novo-1')]).toEqual({
      id: 'ilha-novo-1', tenantId: T1, name: 'Sul', supervisorId: 'sup-2',
    });
    expect(outcome(createIlha(state, uid('admin'), { name: 'Sul', supervisorId: uid('ag-1') }, makeDeps()))).toBe('invalid-supervisor');
    expect(outcome(createIlha(state, uid('admin'), { name: 'Sul', supervisorId: uid('sup-1-b') }, makeDeps()))).toBe('invalid-supervisor');
    expect(outcome(createIlha(state, uid('admin'), { name: '', supervisorId: uid('sup-1') }, makeDeps()))).toBe('invalid-name');
    const renamed = renameIlha(state, uid('admin'), iid('ilha-1'), 'Norte');
    expect(renamed.ok && renamed.value.directory.ilhas[iid('ilha-1')]?.name).toBe('Norte');
    expect(outcome(renameIlha(state, uid('admin'), iid('ilha-1-b'), 'Norte'))).toBe('unknown-ilha');
    const assigned = assignIlhaSupervisor(state, uid('admin'), iid('ilha-1'), uid('sup-2'));
    expect(assigned.ok && assigned.value.directory.ilhas[iid('ilha-1')]?.supervisorId).toBe('sup-2');
    expect(outcome(assignIlhaSupervisor(state, uid('admin'), iid('ilha-1'), uid('sup-1')))).toBe('no-change');
    expect(outcome(assignIlhaSupervisor(state, uid('admin'), iid('ilha-1'), uid('admin')))).toBe('invalid-supervisor');
  });

  it('usuário desativado não conecta; reativar devolve; histórico (registro) preservado', () => {
    const off = deactivateUser(state, uid('sup-1'), uid('ag-1'));
    expect(off.ok).toBe(true);
    if (off.ok) {
      expect(canConnect(off.value.directory, uid('ag-1'))).toBe(false);
      expect(user(off.value.directory, 'ag-1')).toMatchObject({ id: 'ag-1', name: 'ag-1', ilhaId: 'ilha-1', active: false });
      expect(outcome(deactivateUser(off.value, uid('sup-1'), uid('ag-1')))).toBe('no-change');
      const on = reactivateUser(off.value, uid('sup-1'), uid('ag-1'));
      expect(on.ok && canConnect(on.value.directory, uid('ag-1'))).toBe(true);
    }
    expect(canConnect(state.directory, uid('ag-1'))).toBe(true);
    expect(canConnect(state.directory, uid('ag-1-b'))).toBe(false);
    expect(canConnect(state.directory, uid('__proto__'))).toBe(false);
  });

  it('ator desativado é negado em qualquer operação', () => {
    const dead = (id: string): AdminState => ({
      directory: { ...state.directory, users: { ...state.directory.users, [uid(id)]: { ...user(state.directory, id), active: false } } },
      grantLog: [],
    });
    for (const id of ['admin', 'sup-1']) {
      const s = dead(id);
      const ops: AdminResult[] = [
        grantCapability(s, uid(id), uid('ag-1'), 'chat.use', makeDeps()),
        revokeCapability(s, uid(id), uid('ag-1'), 'chat.use', makeDeps()),
        deactivateUser(s, uid(id), uid('ag-1')),
        reactivateUser(s, uid(id), uid('ag-1')),
        moveAgent(s, uid(id), uid('ag-1'), iid('ilha-1b')),
        registerAgent(s, uid(id), { name: 'N', ilhaId: iid('ilha-1') }, makeDeps()),
        registerSupervisor(s, uid(id), { name: 'N', ilhaIds: [] }, makeDeps()),
        createIlha(s, uid(id), { name: 'N', supervisorId: uid('sup-1') }, makeDeps()),
        renameIlha(s, uid(id), iid('ilha-1'), 'N'),
        assignIlhaSupervisor(s, uid(id), iid('ilha-1'), uid('sup-2')),
      ];
      for (const r of ops) {
        expect(r.ok).toBe(false);
      }
      expect(ops.slice(0, 5).map(outcome)).toEqual(Array(5).fill('actor-inactive'));
    }
  });
});

describe('motivos legíveis (GrantDenial)', () => {
  const d = baseDirectory(withGrants([]));
  const text = (r: ReturnType<typeof canGrantIn>): string => (r.ok ? 'ok' : r.error === 'unknown-actor' ? r.error : GRANT_DENIAL_TEXT[r.error]);

  it('textos em português para cada motivo da UI', () => {
    expect(text(canGrantIn(d, uid('sup-1'), uid('sup-2'), 'chat.use'))).toBe('acima do papel');
    expect(text(canGrantIn(d, uid('sup-1'), uid('ag-1'), 'group.manage'))).toBe('acima do papel');
    expect(text(canGrantIn(d, uid('sup-1'), uid('sup-1'), 'chat.use'))).toBe('não pode alterar a si mesmo');
    expect(text(canGrantIn(d, uid('admin'), uid('admin'), 'chat.use'))).toBe('não pode alterar a si mesmo');
    expect(text(canGrantIn(d, uid('sup-1'), uid('ag-3'), 'chat.use'))).toBe('fora das suas ilhas');
    expect(text(canGrantIn(d, uid('sup-1'), uid('ag-sem'), 'chat.use'))).toBe('fora das suas ilhas');
    expect(text(canGrantIn(d, uid('sup-1'), uid('ag-1-b'), 'chat.use'))).toBe('outra empresa');
    expect(text(canGrantIn(d, uid('sup-1'), uid('inexistente'), 'chat.use'))).toBe('outra empresa');
    expect(text(canGrantIn(d, uid('sup-1'), uid('ag-1'), 'chat.use'))).toBe('ok');
    const semPosse: Directory = {
      ...d,
      users: { ...d.users, [uid('sup-1')]: makeUser('supervisor', 'sup-1', { grants: ['grants.manage', 'agents.manage'] }) },
    };
    expect(text(canGrantIn(semPosse, uid('sup-1'), uid('ag-1'), 'chat.use'))).toBe('você não possui');
    expect(text(canRevokeIn(semPosse, uid('sup-1'), uid('ag-3'), 'chat.use'))).toBe('você não possui');
    expect(canRevokeIn(d, uid('sup-1'), uid('ag-3'), 'chat.use')).toEqual({ ok: false, error: 'outside-islands' });
  });

  it('o tenant vem primeiro: nada de escopo/posse vaza sobre outra empresa', () => {
    const inativo: Directory = { ...d, users: { ...d.users, [uid('sup-1')]: { ...user(d, 'sup-1'), active: false } } };
    expect(canGrantIn(inativo, uid('sup-1'), uid('ag-1-b'), 'announcement.publish')).toEqual({ ok: false, error: 'cross-tenant' });
    expect(canGrantIn(inativo, uid('sup-1'), uid('sup-1-b'), 'group.manage')).toEqual({ ok: false, error: 'cross-tenant' });
  });
});

describe('grantLog', () => {
  const state: AdminState = { directory: baseDirectory(withGrants([])), grantLog: [] };

  it('registra quem, para quem, o quê, concedeu/revogou e quando; só nas aceitas com mudança', () => {
    const deps = makeDeps();
    const a = grantCapability(state, uid('sup-1'), uid('ag-1'), 'chat.use', deps);
    expect(a.ok).toBe(true);
    if (!a.ok) return;
    expect(a.value.grantLog).toEqual([
      { tenantId: T1, actorId: 'sup-1', targetId: 'ag-1', capability: 'chat.use', granted: true, at: 't-1' },
    ]);
    const b = revokeCapability(a.value, uid('admin'), uid('ag-1'), 'chat.use', deps);
    expect(b.ok && b.value.grantLog.map((e) => [e.actorId, e.granted, e.at])).toEqual([
      ['sup-1', true, 't-1'],
      ['admin', false, 't-2'],
    ]);
    // negadas e no-change não gravam e não consomem o relógio
    expect(outcome(grantCapability(a.value, uid('sup-1'), uid('ag-1'), 'chat.use', deps))).toBe('no-change');
    expect(outcome(revokeCapability(state, uid('admin'), uid('ag-1'), 'chat.use', deps))).toBe('no-change');
    expect(outcome(grantCapability(state, uid('sup-1'), uid('ag-3'), 'chat.use', deps))).toBe('outside-islands');
    expect(deps.calls()).toBe(2);
    // o estado de entrada não foi mutado
    expect(state.grantLog).toEqual([]);
    expect(user(state.directory, 'ag-1').grants.size).toBe(0);
  });
});

describe('applyAssignRole: nunca burla grants.manage nem o grantLog (regressão)', () => {
  const customized = (): Directory => {
    const d = baseDirectory();
    return {
      ...d,
      users: {
        ...d.users,
        // supervisor SEM grants.manage; agente com grants customizados (nenhum, para provar que não ganha chat.use)
        [uid('sup-1')]: makeUser('supervisor', 'sup-1', { grants: ['chat.use', 'agents.manage'] }),
        [uid('ag-2')]: makeUser('agent', 'ag-2', { grants: [], ilhaId: iid('ilha-1') }),
      },
    };
  };

  it('supervisor sem grants.manage não zera nem concede grants do agente da ilha dele', () => {
    const d = customized();
    expect(applyAssignRole(d, uid('sup-1'), uid('ag-2'), 'agent', iid('ilha-1'))).toEqual({ ok: false, error: 'role-not-assignable' });
    expect(applyAssignRole(d, uid('sup-1'), uid('ag-2'), 'agent', iid('ilha-1b'))).toEqual({ ok: false, error: 'role-not-assignable' });
    expect(user(d, 'ag-2').grants.size).toBe(0);
  });

  it('o admin muda a role sem ganhar grants: só corta pelo teto', () => {
    const d = customized();
    const promoted = applyAssignRole(d, uid('admin'), uid('ag-2'), 'supervisor');
    expect(promoted.ok && [...user(promoted.value, 'ag-2').grants]).toEqual([]);
    const withChat = applyAssignRole(
      { ...d, users: { ...d.users, [uid('ag-2')]: makeUser('agent', 'ag-2', { grants: ['chat.use'], ilhaId: iid('ilha-1') }) } },
      uid('admin'), uid('ag-2'), 'supervisor',
    );
    expect(withChat.ok && [...user(withChat.value, 'ag-2').grants]).toEqual(['chat.use']);
    const demoted = applyAssignRole(
      { ...d, users: { ...d.users, [uid('sup-2')]: makeUser('supervisor', 'sup-2', { grants: ['chat.use', 'group.manage'] }) }, ilhas: { ...d.ilhas, [iid('ilha-2')]: makeIlha('ilha-2', 'sup-1') } },
      uid('admin'), uid('sup-2'), 'agent', iid('ilha-1'),
    );
    expect(demoted.ok && [...user(demoted.value, 'sup-2').grants]).toEqual(['chat.use']);
  });

  it('mesma role é no-change e agente sem ilha é negado', () => {
    const d = customized();
    expect(applyAssignRole(d, uid('admin'), uid('ag-2'), 'agent', iid('ilha-1b'))).toEqual({ ok: false, error: 'no-change' });
    expect(applyAssignRole(d, uid('admin'), uid('sup-2'), 'agent')).toEqual({ ok: false, error: 'supervises-ilha' });
  });
});

describe('ninguém dá o que não tem no cadastro', () => {
  const d0 = baseDirectory();
  const semChat: Directory = {
    ...d0,
    users: { ...d0.users, [uid('sup-1')]: makeUser('supervisor', 'sup-1', { grants: ['agents.manage', 'grants.manage'] }) },
  };

  it('supervisor sem chat.use cadastra agente: o agente nasce SEM chat.use', () => {
    const viaOp = registerAgent({ directory: semChat, grantLog: [] }, uid('sup-1'), { name: 'Ana', ilhaId: iid('ilha-1') }, makeDeps());
    expect(viaOp.ok && [...user(viaOp.value.directory, 'novo-1').grants]).toEqual([]);
    const viaApply = applyCreate(semChat, uid('sup-1'), { id: uid('x1'), name: 'Bia', role: 'agent', ilhaId: iid('ilha-1') });
    expect(viaApply.ok && [...user(viaApply.value, 'x1').grants]).toEqual([]);
    // com chat.use, nasce com ele
    const normal = registerAgent({ directory: d0, grantLog: [] }, uid('sup-1'), { name: 'Ana', ilhaId: iid('ilha-1') }, makeDeps());
    expect(normal.ok && [...user(normal.value.directory, 'novo-1').grants]).toEqual(['chat.use']);
  });
});

describe('operação negada não consome id nem relógio', () => {
  it('todas as operações que usam deps', () => {
    const state: AdminState = { directory: baseDirectory(), grantLog: [] };
    const used = { n: 0 };
    const deps: OpDeps = {
      now: () => { used.n += 1; return 't'; },
      newUserId: () => { used.n += 1; return uid('zz'); },
      newIlhaId: () => { used.n += 1; return iid('zz'); },
    };
    const results: AdminResult[] = [
      registerAgent(state, uid('ag-1'), { name: 'N', ilhaId: iid('ilha-1') }, deps),
      registerAgent(state, uid('sup-1'), { name: 'N', ilhaId: iid('ilha-2') }, deps),
      registerAgent(state, uid('admin'), { name: 'N', ilhaId: iid('ilha-fantasma') }, deps),
      registerAgent(state, uid('admin'), { name: ' ', ilhaId: iid('ilha-1') }, deps),
      registerSupervisor(state, uid('sup-1'), { name: 'N', ilhaIds: [] }, deps),
      registerSupervisor(state, uid('admin'), { name: '', ilhaIds: [] }, deps),
      registerSupervisor(state, uid('admin'), { name: 'N', ilhaIds: [iid('ilha-1-b')] }, deps),
      createIlha(state, uid('sup-1'), { name: 'N', supervisorId: uid('sup-1') }, deps),
      createIlha(state, uid('admin'), { name: '', supervisorId: uid('sup-1') }, deps),
      createIlha(state, uid('admin'), { name: 'N', supervisorId: uid('ag-1') }, deps),
      grantCapability(state, uid('sup-1'), uid('ag-3'), 'chat.use', deps),
      grantCapability(state, uid('sup-1'), uid('ag-1'), 'chat.use', deps),
      revokeCapability(state, uid('sup-1'), uid('ag-3'), 'chat.use', deps),
    ];
    // ag-1 já tem chat.use no seed: no-change também não grava nem consome
    expect(results.every((r) => !r.ok)).toBe(true);
    expect(used.n).toBe(0);
  });
});

describe('nomes', () => {
  it('um helper único: trim, não vazio, até 80, sem caracteres de controle', () => {
    expect(validName('  Ana  ')).toBe('Ana');
    expect(validName('')).toBeUndefined();
    expect(validName('   ')).toBeUndefined();
    expect(validName('a'.repeat(80))).toBe('a'.repeat(80));
    expect(validName('a'.repeat(81))).toBeUndefined();
    expect(validName('A\u0000B')).toBeUndefined();
    expect(validName('A\nB')).toBeUndefined();
  });

  it('aplicado em cadastro de usuário (inclusive applyCreate), criação e renomeação de ilha', () => {
    const d = baseDirectory();
    const state: AdminState = { directory: d, grantLog: [] };
    const bad = ['', '  ', 'x'.repeat(81), 'a\u0007b'];
    for (const name of bad) {
      expect(applyCreate(d, uid('admin'), { id: uid('n1'), name, role: 'agent', ilhaId: iid('ilha-1') })).toEqual({ ok: false, error: 'invalid-name' });
      expect(applyCreate(d, uid('admin'), { id: uid('n1'), name, role: 'supervisor' })).toEqual({ ok: false, error: 'invalid-name' });
      expect(outcome(registerAgent(state, uid('admin'), { name, ilhaId: iid('ilha-1') }, makeDeps()))).toBe('invalid-name');
      expect(outcome(createIlha(state, uid('admin'), { name, supervisorId: uid('sup-1') }, makeDeps()))).toBe('invalid-name');
      expect(outcome(renameIlha(state, uid('admin'), iid('ilha-1'), name))).toBe('invalid-name');
    }
    const ok1 = applyCreate(d, uid('admin'), { id: uid('n2'), name: '  Zé  ', role: 'agent', ilhaId: iid('ilha-1') });
    expect(ok1.ok && user(ok1.value, 'n2').name).toBe('Zé');
  });
});

describe('describeDenial', () => {
  it('textos curtos em português para cada motivo (Record exaustivo por tipo)', () => {
    expect(describeDenial('role-not-assignable')).toBe('acima do papel');
    expect(describeDenial('no-manage-capability')).toBe('você não possui');
    expect(describeDenial('unknown-ilha')).toBe('ilha inexistente');
    expect(describeDenial('invalid-supervisor')).toBe('supervisor inválido');
    expect(describeDenial('invalid-name')).toBe('nome inválido');
    expect(describeDenial('duplicate-ilha')).toBe('ilha já existe');
    expect(describeDenial('no-change')).toBe('nada a alterar');
    expect(describeDenial('outside-islands')).toBe('fora das suas ilhas');
    expect(describeDenial('self')).toBe('não pode alterar a si mesmo');
    expect(describeDenial('cross-tenant')).toBe('outra empresa');
    for (const [code, text] of Object.entries(DENIAL_TEXT)) {
      expect(text.length, code).toBeGreaterThan(2);
      expect(text, code).not.toBe(code);
      expect(text, code).not.toMatch(/^[a-z]+(-[a-z]+)+$/);
    }
  });
});

describe('predicados com diretório espelham as operações', () => {
  const state: AdminState = { directory: baseDirectory(), grantLog: [] };
  const actors = ['admin', 'sup-1', 'sup-2', 'ag-1', 'inexistente', 'ag-1-b'];
  const code = (r: { ok: true } | { ok: false; error: string }): string => (r.ok ? 'ok' : r.error);
  const sameReason = (pred: string, op: string): void => {
    // no-change só existe na operação (estado de destino já alcançado)
    expect(op === 'no-change' ? pred === 'ok' : pred === op).toBe(true);
  };

  it('registrar agente, mover, ativar/desativar, supervisor e ilhas', () => {
    let compared = 0;
    for (const a of actors) {
      for (const ilha of ['ilha-1', 'ilha-2', 'ilha-1b', 'ilha-fantasma', 'ilha-1-b']) {
        const pred = code(canRegisterAgentIn(state.directory, uid(a), iid(ilha)));
        const op = outcome(registerAgent(state, uid(a), { name: 'N', ilhaId: iid(ilha) }, makeDeps()));
        expect(`${a}/${ilha}: ${pred}`).toBe(`${a}/${ilha}: ${op}`);
        compared += 1;
        for (const t of ['ag-1', 'ag-3', 'ag-sem', 'sup-2', 'admin', 'ag-1-b', 'inexistente', a]) {
          sameReason(code(canMoveAgentIn(state.directory, uid(a), uid(t), iid(ilha))), outcome(moveAgent(state, uid(a), uid(t), iid(ilha))));
          compared += 1;
        }
      }
      for (const t of ['ag-1', 'ag-3', 'ag-sem', 'sup-2', 'admin', 'ag-1-b', 'inexistente', a]) {
        expect(code(canSetActiveIn(state.directory, uid(a), uid(t)))).toBe(
          outcome(deactivateUser(state, uid(a), uid(t))),
        );
        compared += 1;
      }
      expect(code(canRegisterSupervisorIn(state.directory, uid(a)))).toBe(
        outcome(registerSupervisor(state, uid(a), { name: 'N', ilhaIds: [] }, makeDeps())),
      );
      expect(code(canManageIlhasIn(state.directory, uid(a)))).toBe(outcome(renameIlha(state, uid(a), iid('ilha-1'), 'Outro nome')));
      expect(code(canManageIlhasIn(state.directory, uid(a)))).toBe(
        outcome(createIlha(state, uid(a), { name: 'N', supervisorId: uid('sup-1') }, makeDeps())),
      );
    }
    expect(compared).toBeGreaterThan(300);
    // o predicado de agente mostra o que o `can()` de criação não vê: ilha de destino
    expect(code(canRegisterAgentIn(state.directory, uid('sup-1'), iid('ilha-2')))).toBe('outside-islands');
  });
});

describe('supervisor desativado continua dono das ilhas', () => {
  const off = deactivateUser({ directory: baseDirectory(), grantLog: [] }, uid('admin'), uid('sup-1'));

  it('o admin ainda cadastra e move agentes para a ilha; o supervisor desativado, como ator, é negado', () => {
    expect(off.ok).toBe(true);
    if (!off.ok) return;
    expect(off.value.directory.ilhas[iid('ilha-1')]?.supervisorId).toBe('sup-1');
    expect(registerAgent(off.value, uid('admin'), { name: 'N', ilhaId: iid('ilha-1') }, makeDeps()).ok).toBe(true);
    expect(moveAgent(off.value, uid('admin'), uid('ag-3'), iid('ilha-1')).ok).toBe(true);
    expect(outcome(registerAgent(off.value, uid('sup-1'), { name: 'N', ilhaId: iid('ilha-1') }, makeDeps()))).toBe('actor-inactive');
    expect(outcome(moveAgent(off.value, uid('sup-1'), uid('ag-1'), iid('ilha-1b')))).toBe('actor-inactive');
    // mas não pode receber ilha nova
    expect(outcome(assignIlhaSupervisor(off.value, uid('admin'), iid('ilha-2'), uid('sup-1')))).toBe('invalid-supervisor');
  });
});

describe('sem revogação em cascata', () => {
  it('revogar do supervisor não tira a capacidade que ele já concedeu ao agente', () => {
    const deps = makeDeps();
    const start: AdminState = { directory: baseDirectory(withGrants([])), grantLog: [] };
    const granted = grantCapability(start, uid('sup-1'), uid('ag-1'), 'chat.use', deps);
    expect(granted.ok).toBe(true);
    if (!granted.ok) return;
    const revoked = revokeCapability(granted.value, uid('admin'), uid('sup-1'), 'chat.use', deps);
    expect(revoked.ok).toBe(true);
    if (!revoked.ok) return;
    expect(user(revoked.value.directory, 'sup-1').grants.has('chat.use')).toBe(false);
    expect(user(revoked.value.directory, 'ag-1').grants.has('chat.use')).toBe(true);
    expect(revoked.value.grantLog.map((e) => [e.targetId, e.granted])).toEqual([
      ['ag-1', true],
      ['sup-1', false],
    ]);
  });
});
