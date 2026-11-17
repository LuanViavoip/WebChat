import { iid, makeDirectory, makeIlha, makeUser, seedDirectory, T1, T2, uid } from './testing/domainFixtures';
import { canUseCapabilityIn, canViewTeamIn, manageableIlhas } from './directoryOps';
import type { Directory, StaffUser } from './identity';

const names = (d: Directory, actor: string) => manageableIlhas(d, uid(actor)).map((ilha) => ilha.id);

function withUser(d: Directory, next: StaffUser): Directory {
  return { ...d, users: { ...d.users, [next.id]: next } };
}

describe('canUseCapabilityIn (entradas da UI: "Novo grupo" etc.)', () => {
  const d = seedDirectory();
  it('vale com a posse efetiva; sem a capacidade, negado com o motivo', () => {
    expect(canUseCapabilityIn(d, uid('sup-1'), 'group.manage')).toEqual({ ok: true, value: true });
    expect(canUseCapabilityIn(d, uid('ag-1'), 'group.manage')).toEqual({ ok: false, error: 'no-manage-capability' });
  });

  it('grant fora do teto (dado corrompido) nunca vale, e ator desativado ou desconhecido é negado', () => {
    const corrupted = withUser(d, makeUser('agent', 'ag-1', { grants: ['group.manage'], ilhaIds: [iid('ilha-1')] }));
    expect(canUseCapabilityIn(corrupted, uid('ag-1'), 'group.manage').ok).toBe(false);
    const inactive = withUser(d, makeUser('supervisor', 'sup-1', { active: false }));
    expect(canUseCapabilityIn(inactive, uid('sup-1'), 'group.manage')).toEqual({ ok: false, error: 'actor-inactive' });
    expect(canUseCapabilityIn(d, uid('fantasma'), 'group.manage')).toEqual({ ok: false, error: 'unknown-actor' });
  });

  it('revogar a capacidade muda a resposta (é o que faz o botão sumir ao vivo)', () => {
    const revoked = withUser(d, makeUser('supervisor', 'sup-1', { grants: ['chat.use'] }));
    expect(canUseCapabilityIn(revoked, uid('sup-1'), 'group.manage').ok).toBe(false);
  });
});

describe('manageableIlhas', () => {
  const d = seedDirectory();
  it('admin: todas; supervisor: só as dele; agente: nenhuma', () => {
    expect(names(d, 'admin')).toEqual(['ilha-1', 'ilha-2']);
    expect(names(d, 'sup-1')).toEqual(['ilha-1']);
    expect(names(d, 'sup-2')).toEqual(['ilha-2']);
    expect(names(d, 'ag-1')).toEqual([]);
  });

  it('nunca inclui ilha de outro tenant e ator desativado não gere nada', () => {
    const mixed: Directory = {
      ...d,
      ilhas: { ...d.ilhas, [iid('ilha-x')]: makeIlha('ilha-x', 'admin', T2) },
    };
    expect(names(mixed, 'admin')).toEqual(['ilha-1', 'ilha-2']);
    expect(names(withUser(d, makeUser('supervisor', 'sup-1', { active: false })), 'sup-1')).toEqual([]);
  });
});

describe('canViewTeamIn (Equipe)', () => {
  const d = seedDirectory();
  it('supervisor com agents.manage e ilhas vê; o admin (sem ilhas) e o agente não', () => {
    expect(canViewTeamIn(d, uid('sup-1')).ok).toBe(true);
    expect(canViewTeamIn(d, uid('admin'))).toEqual({ ok: false, error: 'outside-islands' });
    expect(canViewTeamIn(d, uid('ag-1')).ok).toBe(false);
  });

  it('supervisor sem agents.manage ou sem ilhas não vê', () => {
    expect(canViewTeamIn(withUser(d, makeUser('supervisor', 'sup-1', { grants: ['chat.use'] })), uid('sup-1')).ok).toBe(false);
    const semIlha = makeDirectory(T1, [makeUser('admin', 'admin'), makeUser('supervisor', 'sup-9')], []);
    expect(canViewTeamIn(semIlha, uid('sup-9'))).toEqual({ ok: false, error: 'outside-islands' });
  });
});
