import fc from 'fast-check';
import { directoryArb, directoryFromShape, directoryShapeArb } from './testing/directoryArb';
import { iid, makeDirectory, makeIlha, makeUser, seedDirectory, seedDirectoryNN, T1, T2, uid, user } from './testing/domainFixtures';
import { canGrantIn, canRevokeIn, inManagementScope, supervisedIlhaIds } from './capabilities';
import { conversationTier, directConversation, type Conversation } from './conversation';
import {
  addAgentToIlha,
  applyCreate,
  assignIlhaSupervisor,
  canAddAgentToIlhaIn,
  canRegisterAgentIn,
  canRemoveAgentFromIlhaIn,
  createIlha,
  describeDenial,
  registerAgent,
  registerSupervisor,
  removeAgentFromIlha,
  unassignIlhaSupervisor,
  type AdminResult,
  type AdminState,
  type OpDeps,
} from './directoryOps';
import { validateDirectory, supervisorsOf, parseStaffUser, type Agent, type StaffUser } from './identity';
import { visibleGrantLog } from './grantLog';

// Regras do N:N (plano da fusão, C2/D1/D4): ilha é o setor; agente em várias ilhas; ilha com vários supervisores.

function deps(): OpDeps {
  let u = 0;
  let i = 0;
  return { now: () => 't', newUserId: () => uid(`novo-${String(++u)}`), newIlhaId: () => iid(`ilha-novo-${String(++i)}`) };
}
const out = (r: { ok: true } | { ok: false; error: string }): string => (r.ok ? 'ok' : r.error);
const stateNN = (): AdminState => ({ directory: seedDirectoryNN(), grantLog: [] });
const ilhasOf = (d: AdminState, id: string): readonly string[] => (user(d.directory, id) as Agent).ilhaIds;
const okState = (r: AdminResult): AdminState => {
  if (!r.ok) throw new Error(r.error);
  return r.value;
};

describe('seed N:N', () => {
  it('é válido e cobre agente em 2 ilhas e ilha com 2 supervisores', () => {
    const d = seedDirectoryNN();
    expect(validateDirectory(d).ok).toBe(true);
    expect(ilhasOf({ directory: d, grantLog: [] }, 'ag-5')).toEqual(['ilha-1', 'ilha-2']);
    expect(d.ilhas[iid('ilha-3')]?.supervisorIds).toEqual(['sup-1', 'sup-2']);
  });
});

describe('validateDirectory no N:N', () => {
  it('agente sem nenhuma ilha (dado adulterado) é orphan-agent', () => {
    const d = seedDirectory();
    const ag = { ...(user(d, 'ag-1') as Agent), ilhaIds: [] as unknown as Agent['ilhaIds'] };
    expect(validateDirectory({ ...d, users: { ...d.users, [ag.id]: ag } })).toEqual({ ok: false, error: 'orphan-agent' });
  });

  it('basta UMA das ilhas do agente não existir para ele ser orphan-agent', () => {
    const d = seedDirectoryNN();
    const ag = makeUser('agent', 'ag-5', { ilhaIds: [iid('ilha-1'), iid('ilha-fantasma')] });
    expect(validateDirectory({ ...d, users: { ...d.users, [ag.id]: ag } })).toEqual({ ok: false, error: 'orphan-agent' });
  });

  it('ilha do agente sem supervisor, ou com um supervisor inválido entre os válidos, é orphan-agent', () => {
    const d = seedDirectoryNN();
    expect(validateDirectory({ ...d, ilhas: { ...d.ilhas, [iid('ilha-3')]: { ...makeIlha('ilha-3', []), supervisorIds: [] } } })).toEqual({ ok: false, error: 'orphan-agent' });
    expect(validateDirectory({ ...d, ilhas: { ...d.ilhas, [iid('ilha-3')]: makeIlha('ilha-3', ['sup-1', 'ag-1']) } })).toEqual({ ok: false, error: 'orphan-agent' });
  });

  it('ilha SEM agentes e sem supervisor é válida (o tipo admite 0 supervisores)', () => {
    const d = seedDirectory();
    expect(validateDirectory({ ...d, ilhas: { ...d.ilhas, [iid('vazia')]: makeIlha('vazia', []) } }).ok).toBe(true);
  });

  it('ilhaIds com repetição é orphan-agent (vínculo único por par)', () => {
    const d = seedDirectory();
    const ag = { ...(user(d, 'ag-1') as Agent), ilhaIds: [iid('ilha-1'), iid('ilha-1')] as Agent['ilhaIds'] };
    expect(validateDirectory({ ...d, users: { ...d.users, [ag.id]: ag } })).toEqual({ ok: false, error: 'orphan-agent' });
  });

  it('todo diretório gerado N:N é válido', () => {
    fc.assert(fc.property(directoryArb, (d) => validateDirectory(d).ok), { numRuns: 300 });
  });
});

describe('supervisorsOf', () => {
  it('agente em 2 ilhas: os supervisores das duas, sem repetir', () => {
    const d = seedDirectoryNN();
    expect(supervisorsOf(d, user(d, 'ag-5') as Agent).map((s) => s.id)).toEqual(['sup-1', 'sup-2']);
    expect(supervisorsOf(d, user(d, 'ag-7') as Agent).map((s) => s.id)).toEqual(['sup-1', 'sup-2']);
    expect(supervisorsOf(d, user(d, 'ag-1') as Agent).map((s) => s.id)).toEqual(['sup-1']);
  });

  it('ilha ou supervisor ausente não entra', () => {
    const d = seedDirectory();
    expect(supervisorsOf(d, makeUser('agent', 'o', { ilhaIds: [iid('x')] }) as Agent)).toEqual([]);
  });
});

describe('parseStaffUser com ilhaIds', () => {
  const raw = { id: 'u1', tenantId: 't1', name: 'Ana', active: true, grants: ['chat.use'], role: 'agent' };
  it('aceita 1 ou mais ilhas', () => {
    const p = parseStaffUser({ ...raw, ilhaIds: ['i1', 'i2'] });
    expect('role' in p && p.role === 'agent' && p.ilhaIds).toEqual(['i1', 'i2']);
  });
  it('rejeita vazio, repetido, não-string e o formato antigo `ilhaId`', () => {
    expect(parseStaffUser({ ...raw, ilhaIds: [] })).toEqual({ error: 'invalid' });
    expect(parseStaffUser({ ...raw, ilhaIds: ['i1', 'i1'] })).toEqual({ error: 'invalid' });
    expect(parseStaffUser({ ...raw, ilhaIds: ['i1', 3] })).toEqual({ error: 'invalid' });
    expect(parseStaffUser({ ...raw, ilhaIds: [''] })).toEqual({ error: 'invalid' });
    expect(parseStaffUser({ ...raw, ilhaId: 'i1' })).toEqual({ error: 'invalid' });
  });
});

describe('escopo de gestão: "alguma ilha"', () => {
  const d = seedDirectoryNN();
  const sup1 = user(d, 'sup-1');
  const sup2 = user(d, 'sup-2');

  it('supervisor de UMA das ilhas do agente gerencia o agente', () => {
    expect(inManagementScope(d, sup1, user(d, 'ag-5'))).toBe(true);
    expect(inManagementScope(d, sup2, user(d, 'ag-5'))).toBe(true);
  });

  it('supervisor de nenhuma ilha do agente não gerencia', () => {
    expect(inManagementScope(d, sup2, user(d, 'ag-1'))).toBe(false);
    expect(inManagementScope(d, sup1, user(d, 'ag-3'))).toBe(false);
  });

  it('ilha com vários supervisores: cada um supervisiona a ilha e gerencia os agentes dela', () => {
    expect(supervisedIlhaIds(d, sup1.id).has('ilha-3')).toBe(true);
    expect(supervisedIlhaIds(d, sup2.id).has('ilha-3')).toBe(true);
    expect(inManagementScope(d, sup1, user(d, 'ag-6'))).toBe(true);
    expect(inManagementScope(d, sup2, user(d, 'ag-6'))).toBe(true);
  });

  it('propriedade: gerencia ⇔ interseção não vazia (cálculo independente), em diretórios N:N arbitrários', () => {
    fc.assert(
      fc.property(directoryArb, (dir) => {
        for (const actor of Object.values(dir.users)) {
          for (const target of Object.values(dir.users)) {
            let expected = false;
            if (actor.role === 'admin') expected = true;
            if (actor.role === 'supervisor' && target.role === 'agent') {
              expected = Object.values(dir.ilhas).some((i) => i.supervisorIds.includes(actor.id) && target.ilhaIds.includes(i.id));
            }
            expect(inManagementScope(dir, actor, target)).toBe(expected);
          }
        }
      }),
      { numRuns: 200 },
    );
  });

  it('canGrantIn / canRevokeIn usam o mesmo escopo (supervisor concede a agente em ilha dele mesmo se há outra ilha)', () => {
    expect(canGrantIn(d, sup1.id, uid('ag-5'), 'chat.use').ok).toBe(true);
    expect(canGrantIn(d, sup2.id, uid('ag-5'), 'chat.use').ok).toBe(true);
    expect(canGrantIn(d, sup2.id, uid('ag-1'), 'chat.use')).toEqual({ ok: false, error: 'outside-islands' });
    expect(canRevokeIn(d, sup2.id, uid('ag-1'), 'chat.use')).toEqual({ ok: false, error: 'outside-islands' });
  });

  it('o teto continua valendo: supervisor não concede group.manage a agente nem a quem é de duas ilhas', () => {
    expect(canGrantIn(d, sup1.id, uid('ag-5'), 'group.manage')).toEqual({ ok: false, error: 'above-target-ceiling' });
  });
});

describe('adicionar/remover vínculo agente-ilha (substitui "mover")', () => {
  it('admin adiciona qualquer ilha do tenant; o vínculo antigo permanece', () => {
    const s = okState(addAgentToIlha(stateNN(), uid('admin'), uid('ag-1'), iid('ilha-2')));
    expect(ilhasOf(s, 'ag-1')).toEqual(['ilha-1', 'ilha-2']);
  });

  it('supervisor: o destino tem de ser ilha DELE e o agente, do escopo dele', () => {
    const base = stateNN();
    expect(out(addAgentToIlha(base, uid('sup-1'), uid('ag-1'), iid('ilha-3')))).toBe('ok');
    expect(out(addAgentToIlha(base, uid('sup-1'), uid('ag-1'), iid('ilha-2')))).toBe('outside-islands');
    // agente fora do escopo dele, ilha dele
    expect(out(addAgentToIlha(base, uid('sup-1'), uid('ag-3'), iid('ilha-1')))).toBe('outside-islands');
    // agente em ilha dele E de outro supervisor (ag-5): no escopo, mas o destino é de outro: negado
    expect(out(addAgentToIlha(base, uid('sup-1'), uid('ag-5'), iid('ilha-2')))).toBe('outside-islands');
    // agente já vinculado à ilha dele: no-change
    expect(out(addAgentToIlha(base, uid('sup-1'), uid('ag-5'), iid('ilha-1')))).toBe('no-change');
  });

  it('já vinculado: no-change; ilha inexistente ou de outro tenant: unknown-ilha; não-agente: target-not-agent', () => {
    const base = stateNN();
    expect(out(addAgentToIlha(base, uid('admin'), uid('ag-1'), iid('ilha-1')))).toBe('no-change');
    expect(out(addAgentToIlha(base, uid('admin'), uid('ag-1'), iid('ilha-fantasma')))).toBe('unknown-ilha');
    expect(out(addAgentToIlha(base, uid('admin'), uid('ag-1'), iid('ilha-1-b')))).toBe('unknown-ilha');
    expect(out(addAgentToIlha(base, uid('admin'), uid('sup-1'), iid('ilha-1')))).toBe('target-not-agent');
  });

  it('remover: tira só aquele vínculo', () => {
    const s = okState(removeAgentFromIlha(stateNN(), uid('admin'), uid('ag-5'), iid('ilha-1')));
    expect(ilhasOf(s, 'ag-5')).toEqual(['ilha-2']);
    expect(validateDirectory(s.directory).ok).toBe(true);
  });

  it('remover o ÚLTIMO vínculo é negado (last-ilha), para o admin também', () => {
    const base = stateNN();
    expect(out(removeAgentFromIlha(base, uid('admin'), uid('ag-1'), iid('ilha-1')))).toBe('last-ilha');
    expect(out(removeAgentFromIlha(base, uid('sup-1'), uid('ag-1'), iid('ilha-1')))).toBe('last-ilha');
    expect(describeDenial('last-ilha')).toBe('o agente precisa de ao menos uma ilha');
  });

  it('remover: supervisor só tira vínculo de ilha DELE; vínculo ausente é no-change', () => {
    const base = stateNN();
    // ag-5 está em ilha-1 (sup-1) e ilha-2 (sup-2)
    expect(out(removeAgentFromIlha(base, uid('sup-1'), uid('ag-5'), iid('ilha-2')))).toBe('outside-islands');
    expect(out(removeAgentFromIlha(base, uid('sup-1'), uid('ag-5'), iid('ilha-1')))).toBe('ok');
    expect(out(removeAgentFromIlha(base, uid('sup-1'), uid('ag-5'), iid('ilha-3')))).toBe('no-change');
  });

  it('predicados com diretório dão o mesmo veredito das operações', () => {
    const base = stateNN();
    for (const actor of ['admin', 'sup-1', 'sup-2', 'ag-1']) {
      for (const target of ['ag-1', 'ag-3', 'ag-5', 'ag-7', 'sup-2']) {
        for (const ilha of ['ilha-1', 'ilha-2', 'ilha-3', 'ilha-fantasma']) {
          const add = out(canAddAgentToIlhaIn(base.directory, uid(actor), uid(target), iid(ilha)));
          const addOp = out(addAgentToIlha(base, uid(actor), uid(target), iid(ilha)));
          expect(add === 'ok' ? ['ok', 'no-change'] : [add]).toContain(addOp);
          const rem = out(canRemoveAgentFromIlhaIn(base.directory, uid(actor), uid(target), iid(ilha)));
          const remOp = out(removeAgentFromIlha(base, uid(actor), uid(target), iid(ilha)));
          expect(rem === 'ok' ? ['ok', 'no-change'] : [rem]).toContain(remOp);
        }
      }
    }
  });
});

describe('supervisores da ilha (N)', () => {
  it('atribuir ACRESCENTA: a ilha passa a ter dois supervisores', () => {
    const s = okState(assignIlhaSupervisor(stateNN(), uid('admin'), iid('ilha-1'), uid('sup-2')));
    expect(s.directory.ilhas[iid('ilha-1')]?.supervisorIds).toEqual(['sup-1', 'sup-2']);
    expect(out(assignIlhaSupervisor(s, uid('admin'), iid('ilha-1'), uid('sup-2')))).toBe('no-change');
  });

  it('remover um supervisor: só o admin; o último não sai (last-supervisor); ausente é no-change', () => {
    const base = stateNN();
    expect(out(unassignIlhaSupervisor(base, uid('sup-1'), iid('ilha-3'), uid('sup-2')))).toBe('no-manage-capability');
    const s = okState(unassignIlhaSupervisor(base, uid('admin'), iid('ilha-3'), uid('sup-2')));
    expect(s.directory.ilhas[iid('ilha-3')]?.supervisorIds).toEqual(['sup-1']);
    expect(out(unassignIlhaSupervisor(s, uid('admin'), iid('ilha-3'), uid('sup-1')))).toBe('last-supervisor');
    expect(out(unassignIlhaSupervisor(s, uid('admin'), iid('ilha-3'), uid('sup-2')))).toBe('no-change');
    expect(out(unassignIlhaSupervisor(s, uid('admin'), iid('ilha-fantasma'), uid('sup-1')))).toBe('unknown-ilha');
  });

  it('sem revogação em cascata: remover o supervisor da ilha não mexe nos grants de ninguém', () => {
    const base = stateNN();
    const s = okState(unassignIlhaSupervisor(base, uid('admin'), iid('ilha-3'), uid('sup-2')));
    expect(s.directory.users).toEqual(base.directory.users);
    expect(s.grantLog).toEqual(base.grantLog);
  });

  it('criar ilha com 2 supervisores; vazio ou inválido: invalid-supervisor', () => {
    const base = stateNN();
    const s = okState(createIlha(base, uid('admin'), { name: 'Nova', supervisorIds: [uid('sup-1'), uid('sup-2'), uid('sup-1')] }, deps()));
    expect(s.directory.ilhas[iid('ilha-novo-1')]?.supervisorIds).toEqual(['sup-1', 'sup-2']);
    expect(out(createIlha(base, uid('admin'), { name: 'Nova', supervisorIds: [] }, deps()))).toBe('invalid-supervisor');
    expect(out(createIlha(base, uid('admin'), { name: 'Nova', supervisorIds: [uid('sup-1'), uid('ag-1')] }, deps()))).toBe('invalid-supervisor');
  });

  it('registrar supervisor em várias ilhas acrescenta o id a cada uma, sem tirar os outros', () => {
    const s = okState(registerSupervisor(stateNN(), uid('admin'), { name: 'Paula', ilhaIds: [iid('ilha-1'), iid('ilha-2')] }, deps()));
    expect(s.directory.ilhas[iid('ilha-1')]?.supervisorIds).toEqual(['sup-1', 'novo-1']);
    expect(s.directory.ilhas[iid('ilha-2')]?.supervisorIds).toEqual(['sup-2', 'novo-1']);
  });
});

describe('cadastro de agente em várias ilhas', () => {
  it('supervisor precisa supervisionar TODAS; admin, qualquer uma do tenant', () => {
    const base = stateNN();
    const mk = (actor: string, ilhas: string[]) => out(registerAgent(base, uid(actor), { name: 'Novo', ilhaIds: ilhas.map(iid) }, deps()));
    expect(mk('sup-1', ['ilha-1', 'ilha-3'])).toBe('ok');
    expect(mk('sup-1', ['ilha-1', 'ilha-2'])).toBe('outside-islands');
    expect(mk('admin', ['ilha-1', 'ilha-2'])).toBe('ok');
    expect(mk('admin', [])).toBe('ilha-required');
    expect(mk('admin', ['ilha-1', 'ilha-fantasma'])).toBe('unknown-ilha');
    const s = okState(registerAgent(base, uid('admin'), { name: 'Novo', ilhaIds: [iid('ilha-2'), iid('ilha-1'), iid('ilha-2')] }, deps()));
    expect(ilhasOf(s, 'novo-1')).toEqual(['ilha-2', 'ilha-1']);
    expect(canRegisterAgentIn(base.directory, uid('sup-1'), [iid('ilha-1'), iid('ilha-3')]).ok).toBe(true);
    expect(canRegisterAgentIn(base.directory, uid('sup-1'), [iid('ilha-1'), iid('ilha-2')])).toEqual({ ok: false, error: 'outside-islands' });
    expect(applyCreate(base.directory, uid('admin'), { id: uid('x'), name: 'X', role: 'agent', ilhaIds: [iid('ilha-1'), iid('ilha-2')] }).ok).toBe(true);
  });
});

describe('grantLog: escopo do supervisor com agente em várias ilhas', () => {
  it('vê a entrada de agente que esteja em ALGUMA ilha dele', () => {
    const d = seedDirectoryNN();
    const entry = { tenantId: T1, actorId: uid('admin'), targetId: uid('ag-5'), capability: 'chat.use' as const, granted: true, at: 't' };
    expect(visibleGrantLog(d, user(d, 'sup-1'), [entry])).toHaveLength(1);
    expect(visibleGrantLog(d, user(d, 'sup-2'), [entry])).toHaveLength(1);
    expect(visibleGrantLog(d, user(d, 'sup-2'), [{ ...entry, targetId: uid('ag-1') }])).toHaveLength(0);
  });
});

describe('conversationTier com N:N', () => {
  const d = seedDirectoryNN();
  const dm = (a: StaffUser, b: StaffUser): Conversation => {
    const r = directConversation(a, b);
    if (!r.ok) throw new Error(r.error);
    return r.value;
  };
  it('agente em 2 ilhas: a direta com o supervisor de QUALQUER das ilhas é priority', () => {
    const ag5 = user(d, 'ag-5');
    expect(conversationTier(dm(ag5, user(d, 'sup-1')), ag5, d)).toBe('priority');
    expect(conversationTier(dm(ag5, user(d, 'sup-2')), ag5, d)).toBe('priority');
    const ag1 = user(d, 'ag-1');
    expect(conversationTier(dm(ag1, user(d, 'sup-2')), ag1, d)).toBe('colleagues');
  });
  it('supervisor: priority com agente de alguma ilha dele (qualquer supervisor de ilha com 2)', () => {
    const ag6 = user(d, 'ag-6');
    expect(conversationTier(dm(ag6, user(d, 'sup-1')), user(d, 'sup-1'), d)).toBe('priority');
    expect(conversationTier(dm(ag6, user(d, 'sup-2')), user(d, 'sup-2'), d)).toBe('priority');
    expect(conversationTier(dm(user(d, 'ag-1'), user(d, 'sup-2')), user(d, 'sup-2'), d)).toBe('colleagues');
  });
});

describe('isolamento de tenant no N:N', () => {
  it('ilha de outro tenant na lista do agente não conta como escopo', () => {
    const d = seedDirectoryNN();
    const intruso = makeDirectory(T1, Object.values(d.users), [...Object.values(d.ilhas), makeIlha('ilha-x', 'sup-1', T2)]);
    expect(supervisedIlhaIds(intruso, uid('sup-1')).has('ilha-x')).toBe(false);
  });
});

describe('gerador de formas: sanidade', () => {
  it('cobre agentes em mais de uma ilha e ilhas com mais de um supervisor', () => {
    let multiAgent = 0;
    let multiSup = 0;
    fc.assert(
      fc.property(directoryShapeArb, (shape) => {
        if (shape.agentIlhas.some((a) => a.length > 1)) multiAgent += 1;
        if (shape.ilhaSupervisors.some((s) => s.length > 1)) multiSup += 1;
        directoryFromShape(shape);
      }),
      { numRuns: 200, seed: 7 },
    );
    expect(multiAgent).toBeGreaterThan(20);
    expect(multiSup).toBeGreaterThan(20);
  });
});
