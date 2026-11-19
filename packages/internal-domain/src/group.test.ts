import { describe, expect, it } from 'vitest';
import { asConversationId } from './conversation';
import { createGroup, updateGroup } from './group';
import { iid, makeUser, seedDirectory, T2, user } from './testing/domainFixtures';

const directory = seedDirectory();
const creator = user(directory, 'sup-1');
const agent = user(directory, 'ag-1');
const base = { directory, id: asConversationId('group:1'), title: 'Plantão', creator, members: [creator, agent], origin: { kind: 'custom' as const, createdBy: creator.id }, createdAt: '2026-11-17T12:00:00.000Z' };

describe('grupos', () => {
  it('exige título, criador, membros únicos e mesmo tenant', () => {
    expect(createGroup(base)).toMatchObject({ ok: true, value: { origin: base.origin, formerMemberIds: [] } });
    expect(createGroup({ ...base, title: ' ' })).toMatchObject({ ok: false, error: 'empty-title' });
    expect(createGroup({ ...base, members: [] })).toMatchObject({ ok: false, error: 'empty-members' });
    expect(createGroup({ ...base, members: [agent] })).toMatchObject({ ok: false, error: 'creator-not-member' });
    expect(createGroup({ ...base, members: [creator, agent, agent] })).toMatchObject({ ok: false, error: 'duplicate-member' });
    expect(createGroup({ ...base, members: [creator, makeUser('agent', 'outro', { tenantId: T2 })] })).toMatchObject({ ok: false, error: 'cross-tenant' });
  });
  it('limita o grupo a 256 membros', () => {
    const members = [creator, ...Array.from({ length: 255 }, (_, i) => makeUser('agent', `member-${String(i)}`))];
    expect(createGroup({ ...base, members }).ok).toBe(true);
    expect(createGroup({ ...base, members: [...members, makeUser('agent', 'extra')] })).toMatchObject({ ok: false, error: 'too-many-members' });
  });
  it('registra ex-membros ao alterar um grupo customizado', () => {
    const created = createGroup(base);
    if (!created.ok) throw new Error(created.error);
    expect(updateGroup(created.value, { title: ' Novo ', add: [user(directory, 'ag-2')], remove: [agent.id] }, directory)).toMatchObject({ ok: true, value: { title: 'Novo', formerMemberIds: [agent.id] } });
  });
  it('recusa edição manual de membros de grupo de ilha', () => {
    const created = createGroup({ ...base, origin: { kind: 'ilha', ilhaId: iid('ilha-1') } });
    if (!created.ok) throw new Error(created.error);
    expect(updateGroup(created.value, { add: [user(directory, 'ag-2')] }, directory)).toMatchObject({ ok: false });
    expect(updateGroup(created.value, { remove: [agent.id] }, directory)).toMatchObject({ ok: false });
  });
});
