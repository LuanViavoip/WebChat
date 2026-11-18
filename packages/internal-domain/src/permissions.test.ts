import { iid, makeDirectory, makeUser, seedDirectory, T1, T2, user } from './testing/domainFixtures';
import { CAPABILITIES, type Capability } from './capabilities';
import { directConversation, type Conversation, type GroupConversation, asConversationId } from './conversation';
import type { Directory, StaffUser, UserId } from './identity';
import { can, type Action } from './permissions';

const d = seedDirectory();
const admin = user(d, 'admin');
const sup1 = user(d, 'sup-1');
const sup2 = user(d, 'sup-2');
const ag1 = user(d, 'ag-1');
const ag2 = user(d, 'ag-2');
const ag3 = user(d, 'ag-3');

const dB = seedDirectory(T2);
const agB = user(dB, 'ag-1-b');
const supB = user(dB, 'sup-1-b');

function dm(a: StaffUser, b: StaffUser): Conversation {
  const result = directConversation(a, b);
  if (!result.ok) throw new Error(result.error);
  return result.value;
}

function group(members: readonly StaffUser[], tenantId = T1): GroupConversation {
  const ids = members.map((m) => m.id) as [UserId, ...UserId[]];
  return {
    kind: 'group',
    id: asConversationId(`grp:${tenantId}:1`),
    tenantId,
    title: 'Grupo',
    origin: { kind: 'custom', createdBy: ids[0] },
    members: ids,
    formerMemberIds: [],
    createdAt: '2026-11-10T12:00:00.000Z',
  };
}

function verdict(actor: StaffUser, action: Action, dir: Directory = d): string {
  const result = can(actor, action, dir);
  return result.ok ? 'ok' : result.error;
}

describe('gestão de grupos', () => {
  const custom = group([sup1, ag1]);
  const automatico: GroupConversation = { ...custom, origin: { kind: 'ilha', ilhaId: iid('ilha-1') } };
  it('exige capacidade e restringe a edição ao dono ou admin', () => {
    expect(verdict(ag1, { type: 'group.manage' })).toBe('no-capability');
    expect(verdict(sup1, { type: 'group.manage', group: custom })).toBe('ok');
    expect(verdict(sup2, { type: 'group.manage', group: custom })).toBe('not-owner');
    expect(verdict(admin, { type: 'group.manage', group: custom })).toBe('ok');
    expect(verdict(sup1, { type: 'group.manage', group: { ...custom, origin: { kind: 'custom', createdBy: admin.id } } })).toBe('not-owner');
  });
  it('permite somente ao admin editar grupo de ilha', () => {
    expect(verdict(sup1, { type: 'group.manage', group: automatico })).toBe('not-owner');
    expect(verdict(admin, { type: 'group.manage', group: automatico })).toBe('ok');
  });
});

// Uma linha por Action; cada uma com a variante cross-tenant esperando 'cross-tenant'.
describe('can: uma linha por Action (ok + variante cross-tenant)', () => {
  const rows: Array<[string, StaffUser, Action, Directory, string]> = [
    ['direct.open agente->colega', ag1, { type: 'direct.open', with: ag2 }, d, 'ok'],
    ['direct.open agente->colega de outro tenant', ag1, { type: 'direct.open', with: agB }, d, 'cross-tenant'],
    ['conversation.send em direta (participante)', ag1, { type: 'conversation.send', conversation: dm(ag1, ag2) }, d, 'ok'],
    [
      'conversation.send em direta de outro tenant',
      ag1,
      { type: 'conversation.send', conversation: dm(agB, supB) },
      d,
      'cross-tenant',
    ],
    ['conversation.send em grupo (membro)', ag1, { type: 'conversation.send', conversation: group([sup1, ag1]) }, d, 'ok'],
    [
      'conversation.send em grupo com membro de outro tenant',
      ag1,
      { type: 'conversation.send', conversation: group([ag1, agB]) },
      d,
      'cross-tenant',
    ],
    ['admin.console admin', admin, { type: 'admin.console' }, d, 'ok'],
    ['admin.console ator de outro tenant', admin, { type: 'admin.console' }, dB, 'cross-tenant'],
    ['grant supervisor->agente chat.use', sup1, { type: 'grant', target: ag1, capability: 'chat.use' }, d, 'ok'],
    ['grant a alvo de outro tenant', sup1, { type: 'grant', target: agB, capability: 'chat.use' }, d, 'cross-tenant'],
    ['assignRole supervisor cria agente', sup1, { type: 'assignRole', target: { tenantId: T1 }, role: 'agent' }, d, 'ok'],
    [
      'assignRole em alvo novo de outro tenant',
      sup1,
      { type: 'assignRole', target: { tenantId: T2 }, role: 'agent' },
      d,
      'cross-tenant',
    ],
  ];

  it.each(rows)('%s', (_name, actor, action, dir, want) => {
    expect(verdict(actor, action, dir)).toBe(want);
  });
});

describe('can: casos obrigatórios', () => {
  it('agente <-> agente do mesmo tenant: ok; de outro tenant: cross-tenant', () => {
    expect(verdict(ag1, { type: 'direct.open', with: ag3 })).toBe('ok');
    expect(verdict(ag1, { type: 'direct.open', with: agB })).toBe('cross-tenant');
    expect(verdict(agB, { type: 'direct.open', with: ag1 }, d)).toBe('cross-tenant');
  });

  it('agente sem chat.use não envia nem abre direta', () => {
    const mudo = makeUser('agent', 'mudo', { grants: [] });
    const dir = makeDirectory(T1, [...Object.values(d.users), mudo], Object.values(d.ilhas));
    expect(verdict(mudo, { type: 'conversation.send', conversation: dm(mudo, ag1) }, dir)).toBe('no-chat-use');
    expect(verdict(mudo, { type: 'direct.open', with: ag1 }, dir)).toBe('no-chat-use');
  });

  it('o alvo sem chat.use não pode ser aberto (não aparece no seletor)', () => {
    const mudo = makeUser('agent', 'mudo', { grants: [] });
    const dir = makeDirectory(T1, [...Object.values(d.users), mudo], Object.values(d.ilhas));
    expect(verdict(ag1, { type: 'direct.open', with: mudo }, dir)).toBe('target-no-chat-use');
  });

  it('admin padrão (com chat.use) pode ser alvo; admin sem chat.use (grants customizados) não', () => {
    expect(verdict(ag1, { type: 'direct.open', with: admin })).toBe('ok');
    const adminSemChat = makeUser('admin', 'admin', {
      grants: ['agents.manage', 'ilhas.manage', 'supervisors.manage', 'grants.manage', 'admin.console'],
    });
    const dir = makeDirectory(T1, [adminSemChat, ...Object.values(d.users).filter((u) => u.role !== 'admin')], Object.values(d.ilhas));
    expect(verdict(ag1, { type: 'direct.open', with: adminSemChat }, dir)).toBe('target-no-chat-use');
    expect(verdict(adminSemChat, { type: 'direct.open', with: ag1 }, dir)).toBe('no-chat-use');
  });

  it('inativo é negado, em qualquer ação', () => {
    const inativo = makeUser('agent', 'inativo', { active: false });
    const dir = makeDirectory(T1, [...Object.values(d.users), inativo], Object.values(d.ilhas));
    expect(verdict(inativo, { type: 'direct.open', with: ag1 }, dir)).toBe('actor-inactive');
    expect(verdict(inativo, { type: 'conversation.send', conversation: dm(inativo, ag1) }, dir)).toBe('actor-inactive');
    expect(verdict(inativo, { type: 'admin.console' }, dir)).toBe('actor-inactive');
  });

  it('não abre direta com alvo inativo nem consigo mesmo', () => {
    const inativo = makeUser('agent', 'inativo', { active: false });
    const dir = makeDirectory(T1, [...Object.values(d.users), inativo], Object.values(d.ilhas));
    expect(verdict(ag1, { type: 'direct.open', with: inativo }, dir)).toBe('target-inactive');
    expect(verdict(ag1, { type: 'direct.open', with: ag1 })).toBe('same-user');
  });

  it('quem não participa não envia', () => {
    expect(verdict(ag1, { type: 'conversation.send', conversation: dm(ag2, ag3) })).toBe('not-participant');
    expect(verdict(ag1, { type: 'conversation.send', conversation: group([sup1, ag2]) })).toBe('not-participant');
  });

  it('o próprio diretório é de outro tenant: cross-tenant antes de inativo', () => {
    const inativoB = makeUser('agent', 'x', { tenantId: T1, active: false });
    expect(verdict(inativoB, { type: 'admin.console' }, dB)).toBe('cross-tenant');
  });

  it('conversa com tenantId de outro tenant, mesmo com participantes do tenant: cross-tenant', () => {
    const base = dm(ag1, ag2);
    expect(verdict(ag1, { type: 'conversation.send', conversation: { ...base, tenantId: T2 } })).toBe('cross-tenant');
  });

  it('participante fora do diretório conta como cross-tenant', () => {
    const outsider = makeUser('agent', 'fantasma');
    expect(verdict(ag1, { type: 'conversation.send', conversation: group([ag1, outsider]) })).toBe('cross-tenant');
  });

  it('admin.console só com a capacidade', () => {
    expect(verdict(sup1, { type: 'admin.console' })).toBe('no-capability');
    expect(verdict(ag1, { type: 'admin.console' })).toBe('no-capability');
  });

  it('grant e assignRole delegam a canGrant/canAssignRole e propagam o motivo', () => {
    expect(verdict(sup1, { type: 'grant', target: sup1, capability: 'chat.use' })).toBe('self');
    expect(verdict(sup1, { type: 'grant', target: user(d, 'sup-2'), capability: 'chat.use' })).toBe('not-higher-rank');
    expect(verdict(sup1, { type: 'assignRole', target: { tenantId: T1 }, role: 'supervisor' })).toBe('no-manage-capability');
    expect(verdict(ag1, { type: 'grant', target: ag2, capability: 'chat.use' })).toBe('no-grants-manage');
  });

  it('ator fantasma (fora do diretório): unknown-actor', () => {
    const fantasma = makeUser('admin', 'fantasma');
    expect(verdict(fantasma, { type: 'admin.console' })).toBe('unknown-actor');
    expect(verdict(fantasma, { type: 'direct.open', with: ag1 })).toBe('unknown-actor');
    expect(verdict(fantasma, { type: 'assignRole', target: { tenantId: T1 }, role: 'agent' })).toBe('unknown-actor');
  });

  it('ator com role forjada: vale o registro do diretório, não o objeto recebido', () => {
    const forjado: StaffUser = { ...ag1, role: 'admin', grants: new Set(CAPABILITIES) };
    expect(verdict(forjado, { type: 'admin.console' })).toBe('no-capability');
    expect(verdict(forjado, { type: 'assignRole', target: { tenantId: T1 }, role: 'supervisor' })).toBe(
      'no-manage-capability',
    );
    expect(verdict(forjado, { type: 'grant', target: ag2, capability: 'chat.use' })).toBe('no-grants-manage');
  });

  it('ator com grants adulterados ou inativo no objeto: vale o diretório', () => {
    const adulterado: StaffUser = { ...ag1, grants: new Set<Capability>([...ag1.grants, 'grants.manage', 'group.manage']) };
    expect(verdict(adulterado, { type: 'grant', target: ag2, capability: 'chat.use' })).toBe('no-grants-manage');
    const mudoNoDiretorio = makeUser('agent', 'mudo', { grants: [] });
    const dir = makeDirectory(T1, [...Object.values(d.users), mudoNoDiretorio], Object.values(d.ilhas));
    const reclamaChat: StaffUser = { ...mudoNoDiretorio, grants: new Set<Capability>(['chat.use']) };
    expect(verdict(reclamaChat, { type: 'direct.open', with: ag1 }, dir)).toBe('no-chat-use');
    const inativoNoDiretorio = makeUser('agent', 'inativo', { active: false });
    const dir2 = makeDirectory(T1, [...Object.values(d.users), inativoNoDiretorio], Object.values(d.ilhas));
    expect(verdict({ ...inativoNoDiretorio, active: true }, { type: 'direct.open', with: ag1 }, dir2)).toBe('actor-inactive');
  });

  it('alvo forjado (mesmo id, role/grants/active diferentes): vale o diretório', () => {
    const alvoForjado: StaffUser = { ...ag2, role: 'supervisor', grants: new Set(CAPABILITIES) };
    // no diretório ag-2 é agente: supervisor concede chat.use a ele
    expect(verdict(sup1, { type: 'grant', target: alvoForjado, capability: 'chat.use' })).toBe('ok');
    // e group.manage continua fora do teto do agente verdadeiro
    expect(verdict(sup1, { type: 'grant', target: alvoForjado, capability: 'group.manage' })).toBe('above-target-ceiling');
    // sup-2 forjado como agente continua sendo supervisor
    const sup2Forjado: StaffUser = { ...makeUser('agent', 'sup-2'), grants: new Set<Capability>(['chat.use']) };
    expect(verdict(sup1, { type: 'grant', target: sup2Forjado, capability: 'chat.use' })).toBe('not-higher-rank');
    expect(verdict(sup1, { type: 'assignRole', target: { ...ag2, role: 'supervisor' } as StaffUser, role: 'agent' })).toBe('ok');
    // direct.open: alvo inativo forjado como ativo
    const inativo = makeUser('agent', 'inativo', { active: false });
    const dir = makeDirectory(T1, [...Object.values(d.users), inativo], Object.values(d.ilhas));
    expect(verdict(ag1, { type: 'direct.open', with: { ...inativo, active: true } }, dir)).toBe('target-inactive');
  });

  it('alvo ausente do diretório ou de tenant forjado: cross-tenant', () => {
    const fantasma = makeUser('agent', 'fantasma');
    expect(verdict(sup1, { type: 'grant', target: fantasma, capability: 'chat.use' })).toBe('cross-tenant');
    expect(verdict(sup1, { type: 'assignRole', target: fantasma, role: 'agent' })).toBe('cross-tenant');
    expect(verdict(ag1, { type: 'direct.open', with: fantasma })).toBe('cross-tenant');
    expect(verdict(ag1, { type: 'direct.open', with: { ...ag2, tenantId: T2 } })).toBe('cross-tenant');
  });

  it("ids herdados do Object ('__proto__', 'constructor') não resolvem como usuários", () => {
    const proto = makeUser('admin', '__proto__');
    const ctor = makeUser('agent', 'constructor');
    expect(verdict(proto, { type: 'admin.console' })).toBe('unknown-actor');
    expect(verdict(ctor, { type: 'admin.console' })).toBe('unknown-actor');
    expect(verdict(ag1, { type: 'direct.open', with: ctor })).toBe('cross-tenant');
  });
});
