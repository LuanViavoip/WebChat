import { addAgentToIlha, removeAgentFromIlha, type GrantLogEntry } from './directoryOps';
import { canReadGrantLog, visibleGrantLog } from './grantLog';
import { iid, seedDirectory, T1, T2, uid, user } from './testing/domainFixtures';

const d = seedDirectory();
const entry = (actor: string, target: string, tenantId = T1): GrantLogEntry => ({
  tenantId,
  actorId: uid(actor),
  targetId: uid(target),
  capability: 'group.manage',
  granted: true,
  at: '2026-11-16T10:00:00.000Z',
});

const log = [
  entry('admin', 'sup-1'), // alvo supervisor
  entry('admin', 'sup-2'),
  entry('sup-1', 'ag-1'), // feito por sup-1, agente da ilha 1
  entry('sup-2', 'ag-3'), // feito por sup-2, agente da ilha 2
  entry('admin', 'ag-2'), // agente da ilha 1, feito pelo admin
  entry('admin', 'ag-4'), // agente da ilha 2
];

describe('visibleGrantLog', () => {
  it('admin vê o log inteiro da empresa', () => {
    expect(visibleGrantLog(d, user(d, 'admin'), log)).toEqual(log);
  });

  it('supervisor vê só o que fez ou o que tem agente das ilhas dele como alvo', () => {
    expect(visibleGrantLog(d, user(d, 'sup-1'), log)).toEqual([log[2], log[4]]);
    expect(visibleGrantLog(d, user(d, 'sup-2'), log)).toEqual([log[3], log[5]]);
  });

  it('agente não lê', () => {
    expect(canReadGrantLog(user(d, 'ag-1'))).toBe(false);
    expect(visibleGrantLog(d, user(d, 'ag-1'), log)).toEqual([]);
  });

  it('entrada de outro tenant nunca aparece, nem para o admin', () => {
    const foreign = entry('admin', 'sup-1', T2);
    expect(visibleGrantLog(d, user(d, 'admin'), [...log, foreign])).toEqual(log);
    expect(visibleGrantLog(d, user(d, 'sup-1'), [foreign])).toEqual([]);
  });

  it('leitor desativado ou de outro tenant não lê', () => {
    expect(visibleGrantLog(d, { ...user(d, 'admin'), active: false }, log)).toEqual([]);
    expect(visibleGrantLog(seedDirectory(T2), user(d, 'admin'), log)).toEqual([]);
  });

  it('o escopo é o atual: mover o agente (acrescentar + remover vínculo) muda o que o supervisor enxerga', () => {
    // mover = acrescentar o vínculo novo e tirar o antigo
    const added = addAgentToIlha({ directory: d, grantLog: [] }, uid('admin'), uid('ag-1'), iid('ilha-2'));
    if (!added.ok) {
      throw new Error('acrescentar deveria passar');
    }
    const moved = removeAgentFromIlha(added.value, uid('admin'), uid('ag-1'), iid('ilha-1'));
    if (!moved.ok) {
      throw new Error('mover deveria passar');
    }
    expect(visibleGrantLog(moved.value.directory, user(d, 'sup-1'), log)).toEqual([log[2], log[4]]);
    expect(visibleGrantLog(moved.value.directory, user(d, 'sup-2'), log)).toEqual([log[2], log[3], log[5]]);
  });
});
