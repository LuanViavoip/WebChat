import { makeUser, T1, T2 } from './testing/domainFixtures';
import {
  CAPABILITIES,
  ROLE_CEILING,
  ROLE_DEFAULT,
  ROLE_RANK,
  canAssignRole,
  canGrant,
  canRevoke,
  grantsAfterRoleChange,
  type Capability,
  type GrantDenial,
  type RoleDenial,
} from './capabilities';
import type { StaffUser } from './identity';

type R = 'admin' | 'supervisor' | 'agent';
const ROLES: readonly R[] = ['admin', 'supervisor', 'agent'];

// Tabelas ESCRITAS À MÃO: o esperado da matriz não depende do código sob teste.
const HELD: Record<R, readonly Capability[]> = {
  admin: [
    'chat.use', 'group.manage', 'announcement.publish', 'announcement.receipts', 'announcement.moderate',
    'agents.manage', 'ilhas.manage', 'supervisors.manage', 'grants.manage', 'admin.console',
  ],
  supervisor: [
    'chat.use', 'group.manage', 'announcement.publish', 'announcement.receipts', 'announcement.moderate',
    'agents.manage', 'grants.manage',
  ],
  agent: ['chat.use'],
};
const RANK: Record<R, number> = { admin: 3, supervisor: 2, agent: 1 };

function expectedGrant(
  actorRole: R,
  targetRole: R,
  capability: Capability,
  sameUser: boolean,
  sameTenant: boolean,
  withCeiling: boolean,
): GrantDenial | 'ok' {
  if (!sameTenant) return 'cross-tenant';
  if (sameUser) return 'self';
  if (!HELD[actorRole].includes('grants.manage')) return 'no-grants-manage';
  if (!HELD[actorRole].includes(capability)) return 'actor-lacks-capability';
  if (withCeiling && !HELD[targetRole].includes(capability)) return 'above-target-ceiling';
  if (RANK[actorRole] <= RANK[targetRole]) return 'not-higher-rank';
  return 'ok';
}

type GrantRow = {
  name: string;
  actor: StaffUser;
  target: StaffUser;
  capability: Capability;
  grant: GrantDenial | 'ok';
  revoke: Exclude<GrantDenial, 'above-target-ceiling'> | 'ok';
};

function grantRows(): GrantRow[] {
  const rows: GrantRow[] = [];
  for (const actorRole of ROLES) {
    for (const targetRole of ROLES) {
      for (const capability of CAPABILITIES) {
        for (const sameUser of [false, true]) {
          if (sameUser && actorRole !== targetRole) continue;
          for (const sameTenant of [true, false]) {
            const actor = makeUser(actorRole, 'ator', { grants: HELD[actorRole] });
            const target = makeUser(targetRole, sameUser ? 'ator' : 'alvo', {
              tenantId: sameTenant ? T1 : T2,
              grants: HELD[targetRole],
            });
            const revoke = expectedGrant(actorRole, targetRole, capability, sameUser, sameTenant, false);
            rows.push({
              name: `${actorRole} -> ${targetRole} ${capability} ${sameUser ? 'mesmo usuário' : 'outro'} ${sameTenant ? 'mesmo tenant' : 'outro tenant'}`,
              actor,
              target,
              capability,
              grant: expectedGrant(actorRole, targetRole, capability, sameUser, sameTenant, true),
              revoke: revoke as GrantRow['revoke'],
            });
          }
        }
      }
    }
  }
  return rows;
}

function outcome(result: { ok: true } | { ok: false; error: string }): string {
  return result.ok ? 'ok' : result.error;
}

describe('canGrant: matriz ator x alvo x capacidade x usuário x tenant', () => {
  const rows = grantRows();

  it('cobre a matriz inteira (3 x 3 x 10 x {mesmo,outro} x {mesmo,outro})', () => {
    // 9 pares de role x 10 capacidades x 2 tenants = 180 "outro usuário" + 3 pares iguais x 10 x 2 = 60 "mesmo usuário"
    expect(rows).toHaveLength(240);
  });

  it.each(rows.map((row) => [row.name, row] as const))('%s', (_name, row) => {
    expect(outcome(canGrant(row.actor, row.target, row.capability))).toBe(row.grant);
  });

  it.each(rows.map((row) => [row.name, row] as const))('canRevoke: %s', (_name, row) => {
    expect(outcome(canRevoke(row.actor, row.target, row.capability))).toBe(row.revoke);
  });
});

describe('canGrant: casos explícitos', () => {
  const sup = makeUser('supervisor', 'sup');
  const agent = makeUser('agent', 'ag');

  it('supervisor concede chat.use a agente: ok', () => {
    expect(canGrant(sup, agent, 'chat.use')).toEqual({ ok: true, value: true });
  });

  it('supervisor concede a supervisor: not-higher-rank', () => {
    const outro = makeUser('supervisor', 'sup-2');
    expect(canGrant(sup, outro, 'chat.use')).toEqual({ ok: false, error: 'not-higher-rank' });
  });

  it('supervisor concede o que não tem: actor-lacks-capability', () => {
    expect(canGrant(sup, agent, 'ilhas.manage')).toEqual({ ok: false, error: 'actor-lacks-capability' });
    const semChat = makeUser('supervisor', 'sup-sem', { grants: ['grants.manage', 'agents.manage'] });
    expect(canGrant(semChat, agent, 'chat.use')).toEqual({ ok: false, error: 'actor-lacks-capability' });
  });

  it('supervisor só concede dentro do teto do agente', () => {
    expect(canGrant(sup, agent, 'group.manage')).toEqual({ ok: false, error: 'above-target-ceiling' });
  });

  it('supervisor altera a si mesmo: self', () => {
    expect(canGrant(sup, sup, 'chat.use')).toEqual({ ok: false, error: 'self' });
  });

  it('admin concede ao supervisor qualquer capacidade do teto dele, inclusive agents.manage e grants.manage', () => {
    const admin = makeUser('admin', 'adm');
    expect(canGrant(admin, sup, 'agents.manage').ok).toBe(true);
    expect(canGrant(admin, sup, 'grants.manage').ok).toBe(true);
    expect(canGrant(admin, sup, 'supervisors.manage')).toEqual({ ok: false, error: 'above-target-ceiling' });
    expect(canGrant(admin, sup, 'admin.console')).toEqual({ ok: false, error: 'above-target-ceiling' });
  });

  it('agente nunca concede', () => {
    expect(canGrant(agent, makeUser('agent', 'ag-2'), 'chat.use')).toEqual({ ok: false, error: 'no-grants-manage' });
  });

  it('ator inativo: actor-inactive, antes de grants.manage e posse', () => {
    const inativoAdmin = makeUser('admin', 'adm', { active: false });
    expect(canGrant(inativoAdmin, agent, 'chat.use')).toEqual({ ok: false, error: 'actor-inactive' });
    const inativoSemGrants = makeUser('supervisor', 'sup-i', { active: false, grants: [] });
    expect(canGrant(inativoSemGrants, agent, 'chat.use')).toEqual({ ok: false, error: 'actor-inactive' });
    expect(canRevoke(inativoAdmin, agent, 'chat.use')).toEqual({ ok: false, error: 'actor-inactive' });
  });

  it('tenant vem primeiro: ator inativo e de outro tenant dá cross-tenant', () => {
    const inativoOutro = makeUser('admin', 'adm', { active: false, tenantId: T2 });
    expect(canGrant(inativoOutro, agent, 'chat.use')).toEqual({ ok: false, error: 'cross-tenant' });
  });
});

describe('canRevoke: casos explícitos', () => {
  const sup = makeUser('supervisor', 'sup');
  const agent = makeUser('agent', 'ag');

  it('supervisor revoga chat.use de agente: ok', () => {
    expect(canRevoke(sup, agent, 'chat.use')).toEqual({ ok: true, value: true });
  });

  it('não revoga de supervisor, de si mesmo nem sem grants.manage', () => {
    expect(canRevoke(sup, makeUser('supervisor', 'sup-2'), 'chat.use')).toEqual({ ok: false, error: 'not-higher-rank' });
    expect(canRevoke(sup, sup, 'chat.use')).toEqual({ ok: false, error: 'self' });
    expect(canRevoke(agent, makeUser('agent', 'ag-2'), 'chat.use')).toEqual({ ok: false, error: 'no-grants-manage' });
  });

  it('revogar capacidade fora do teto do alvo não é bloqueado pelo teto (limpeza de legado)', () => {
    const admin = makeUser('admin', 'adm');
    expect(canRevoke(admin, agent, 'group.manage')).toEqual({ ok: true, value: true });
  });
});

type TargetKind = 'novo' | R;

describe('canAssignRole: matriz', () => {
  const ASSIGNED = ['supervisor', 'agent'] as const;
  const MANAGE = { supervisor: 'supervisors.manage', agent: 'agents.manage' } as const;

  function expected(
    actorRole: R,
    kind: TargetKind,
    self: boolean,
    role: 'supervisor' | 'agent',
    sameTenant: boolean,
  ): RoleDenial | 'ok' {
    if (!sameTenant) return 'cross-tenant';
    if (self) return 'self';
    const needed: Capability[] = [MANAGE[role]];
    if (kind === 'supervisor' || kind === 'agent') needed.push(MANAGE[kind]);
    if (!needed.every((capability) => HELD[actorRole].includes(capability))) return 'no-manage-capability';
    if (kind === 'admin') return 'role-not-assignable';
    if (kind !== 'novo' && RANK[actorRole] <= RANK[kind]) return 'role-not-assignable';
    return 'ok';
  }

  const rows: Array<{
    name: string;
    actor: StaffUser;
    target: StaffUser | { tenantId: typeof T1 };
    role: 'supervisor' | 'agent';
    want: RoleDenial | 'ok';
  }> = [];
  for (const actorRole of ROLES) {
    for (const kind of ['novo', ...ROLES] as const) {
      for (const self of [false, true]) {
        if (self && kind !== actorRole) continue;
        for (const role of ASSIGNED) {
          for (const sameTenant of [true, false]) {
            const actor = makeUser(actorRole, 'ator', { grants: HELD[actorRole] });
            const tenantId = sameTenant ? T1 : T2;
            const target =
              kind === 'novo'
                ? { tenantId }
                : makeUser(kind, self ? 'ator' : 'alvo', { tenantId, grants: HELD[kind] });
            rows.push({
              name: `${actorRole} -> ${kind}${self ? ' (self)' : ''} como ${role} ${sameTenant ? 'mesmo' : 'outro'} tenant`,
              actor,
              target,
              role,
              want: expected(actorRole, kind, self, role, sameTenant),
            });
          }
        }
      }
    }
  }

  it('cobre todos os pares de role (incluindo alvo novo e self) x role atribuída x tenant', () => {
    // por ator: novo (4) + 3 roles existentes (12) + self (4) = 20
    expect(rows).toHaveLength(60);
  });

  it.each(rows.map((row) => [row.name, row] as const))('%s', (_name, row) => {
    expect(outcome(canAssignRole(row.actor, row.target, row.role))).toBe(row.want);
  });

  it('supervisor cadastra agente: ok', () => {
    const sup = makeUser('supervisor', 'sup');
    expect(canAssignRole(sup, { tenantId: T1 }, 'agent')).toEqual({ ok: true, value: true });
  });

  it("supervisor atribui 'supervisor': negado, novo ou existente", () => {
    const sup = makeUser('supervisor', 'sup');
    expect(canAssignRole(sup, { tenantId: T1 }, 'supervisor').ok).toBe(false);
    expect(canAssignRole(sup, makeUser('agent', 'ag'), 'supervisor').ok).toBe(false);
  });

  it('supervisor não rebaixa supervisor nem mexe em admin', () => {
    const sup = makeUser('supervisor', 'sup');
    expect(canAssignRole(sup, makeUser('supervisor', 'sup-2'), 'agent').ok).toBe(false);
    expect(canAssignRole(sup, makeUser('admin', 'adm'), 'agent')).toEqual({ ok: false, error: 'role-not-assignable' });
  });

  it('supervisor altera a si mesmo: self', () => {
    const sup = makeUser('supervisor', 'sup');
    expect(canAssignRole(sup, sup, 'agent')).toEqual({ ok: false, error: 'self' });
  });

  it('admin cria supervisor e agente; não altera a si mesmo', () => {
    const admin = makeUser('admin', 'adm');
    expect(canAssignRole(admin, { tenantId: T1 }, 'supervisor').ok).toBe(true);
    expect(canAssignRole(admin, { tenantId: T1 }, 'agent').ok).toBe(true);
    expect(canAssignRole(admin, admin, 'agent')).toEqual({ ok: false, error: 'self' });
  });

  it('ator inativo: actor-inactive (depois de tenant e self)', () => {
    const inativo = makeUser('admin', 'adm', { active: false });
    expect(canAssignRole(inativo, { tenantId: T1 }, 'agent')).toEqual({ ok: false, error: 'actor-inactive' });
    expect(canAssignRole(inativo, inativo, 'agent')).toEqual({ ok: false, error: 'self' });
    expect(canAssignRole(inativo, { tenantId: T2 }, 'agent')).toEqual({ ok: false, error: 'cross-tenant' });
  });
});

describe('catálogo e tetos', () => {
  it('o catálogo tem as 10 capacidades', () => {
    expect(CAPABILITIES).toHaveLength(10);
  });

  it('decisões do Luan: admin usa o chat; supervisor ganha agents.manage e grants.manage', () => {
    expect(ROLE_DEFAULT.admin.has('chat.use')).toBe(true);
    expect([...ROLE_DEFAULT.admin].sort()).toEqual([...CAPABILITIES].sort());
    expect(ROLE_CEILING.supervisor.has('agents.manage')).toBe(true);
    expect(ROLE_CEILING.supervisor.has('grants.manage')).toBe(true);
    expect(ROLE_DEFAULT.supervisor.has('agents.manage')).toBe(true);
    expect(ROLE_DEFAULT.supervisor.has('grants.manage')).toBe(true);
  });

  it('supervisor nunca tem supervisors.manage, ilhas.manage nem admin.console no teto', () => {
    for (const capability of ['supervisors.manage', 'ilhas.manage', 'admin.console'] as const) {
      expect(ROLE_CEILING.supervisor.has(capability)).toBe(false);
    }
  });

  it('o padrão de cada role está dentro do teto e o rank é estrito', () => {
    for (const role of ROLES) {
      for (const capability of ROLE_DEFAULT[role]) {
        expect(ROLE_CEILING[role].has(capability)).toBe(true);
      }
    }
    expect(ROLE_RANK.admin).toBeGreaterThan(ROLE_RANK.supervisor);
    expect(ROLE_RANK.supervisor).toBeGreaterThan(ROLE_RANK.agent);
  });

  it('mudar de role zera os grants para o padrão da role nova', () => {
    expect([...grantsAfterRoleChange('agent')]).toEqual(['chat.use']);
    expect([...grantsAfterRoleChange('supervisor')].sort()).toEqual([...HELD.supervisor].sort());
  });
});

// Tabelas LITERAIS (escritas à mão) de TUDO o que dá ok com os grants default,
// ator ativo, mesmo tenant e usuário diferente. Qualquer ok fora daqui é regressão.
const GRANT_OK_TABLE: readonly string[] = [
  'admin>supervisor:chat.use',
  'admin>supervisor:group.manage',
  'admin>supervisor:announcement.publish',
  'admin>supervisor:announcement.receipts',
  'admin>supervisor:announcement.moderate',
  'admin>supervisor:agents.manage',
  'admin>supervisor:grants.manage',
  'admin>agent:chat.use',
  'supervisor>agent:chat.use',
];

const ASSIGN_OK_TABLE: readonly string[] = [
  'admin>novo:supervisor',
  'admin>novo:agent',
  'admin>supervisor:supervisor',
  'admin>supervisor:agent',
  'admin>agent:supervisor',
  'admin>agent:agent',
  'supervisor>novo:agent',
  'supervisor>agent:agent',
];

describe('conjunto exato de resultados ok (grants default)', () => {
  it('canGrant: o conjunto de ok é exatamente a tabela literal, variando ator inativo, tenant e self', () => {
    const okKeys = new Set<string>();
    for (const actorRole of ROLES) {
      for (const targetRole of ROLES) {
        for (const capability of CAPABILITIES) {
          for (const active of [true, false]) {
            for (const sameTenant of [true, false]) {
              for (const sameUser of [false, true]) {
                const actor = makeUser(actorRole, 'ator', { active });
                const target = makeUser(targetRole, sameUser ? 'ator' : 'alvo', { tenantId: sameTenant ? T1 : T2 });
                if (canGrant(actor, target, capability).ok) {
                  expect({ active, sameTenant, sameUser }).toEqual({ active: true, sameTenant: true, sameUser: false });
                  okKeys.add(`${actorRole}>${targetRole}:${capability}`);
                }
              }
            }
          }
        }
      }
    }
    expect([...okKeys].sort()).toEqual([...GRANT_OK_TABLE].sort());
  });

  it('canAssignRole: o conjunto de ok é exatamente a tabela literal, variando ator inativo, tenant e self', () => {
    const okKeys = new Set<string>();
    for (const actorRole of ROLES) {
      for (const kind of ['novo', ...ROLES] as const) {
        for (const role of ['supervisor', 'agent'] as const) {
          for (const active of [true, false]) {
            for (const sameTenant of [true, false]) {
              for (const self of [false, true]) {
                if (self && kind === 'novo') continue;
                const actor = makeUser(actorRole, 'ator', { active });
                const tenantId = sameTenant ? T1 : T2;
                const target =
                  kind === 'novo' ? { tenantId } : makeUser(kind, self ? 'ator' : 'alvo', { tenantId });
                if (canAssignRole(actor, target, role).ok) {
                  expect({ active, sameTenant, self }).toEqual({ active: true, sameTenant: true, self: false });
                  okKeys.add(`${actorRole}>${kind}:${role}`);
                }
              }
            }
          }
        }
      }
    }
    expect([...okKeys].sort()).toEqual([...ASSIGN_OK_TABLE].sort());
  });
});

describe('posse efetiva = grants ∩ teto da role', () => {
  it('agente com grants.manage/group.manage adulterados não concede nada', () => {
    const inflado = makeUser('agent', 'inflado', { grants: ['chat.use', 'grants.manage', 'group.manage'] });
    expect(canGrant(inflado, makeUser('agent', 'alvo'), 'chat.use')).toEqual({ ok: false, error: 'no-grants-manage' });
    expect(canRevoke(inflado, makeUser('agent', 'alvo'), 'chat.use')).toEqual({ ok: false, error: 'no-grants-manage' });
    expect(canAssignRole(inflado, { tenantId: T1 }, 'agent')).toEqual({ ok: false, error: 'no-manage-capability' });
  });

  it('supervisor com supervisors.manage adulterado continua sem atribuir supervisor', () => {
    const inflado = makeUser('supervisor', 'inflado', { grants: [...HELD.supervisor, 'supervisors.manage', 'admin.console'] });
    expect(canAssignRole(inflado, { tenantId: T1 }, 'supervisor').ok).toBe(false);
    expect(canGrant(inflado, makeUser('agent', 'alvo'), 'admin.console')).toEqual({ ok: false, error: 'actor-lacks-capability' });
  });

  it('hierarquia da role atribuída vale mesmo com a capacidade de gestão (via admin com grants cheios)', () => {
    const sup = makeUser('supervisor', 'sup', { grants: CAPABILITIES });
    expect(canAssignRole(sup, { tenantId: T1 }, 'supervisor').ok).toBe(false);
    expect(canAssignRole(sup, makeUser('agent', 'ag'), 'supervisor').ok).toBe(false);
    expect(canAssignRole(sup, { tenantId: T1 }, 'agent').ok).toBe(true);
  });
});
