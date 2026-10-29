import type { Announcement, SectorSummary, SupervisorAgent } from '@viavoip/protocol';
import { describe, expect, it } from 'vitest';
import { orderAnnouncements } from '../src/announcements/order.js';
import { addableMembers, knownPeople, supervisorCandidates } from '../src/sectors/people.js';
import { distinctActivities, distinctSectors, filterAgents } from '../src/supervisor/agents.js';

function announcement(id: string, publishedAt: string, extra: Partial<Announcement> = {}): Announcement {
  return {
    id,
    title: id,
    body: 'texto',
    pinned: false,
    audience: 'tenant',
    sectorIds: [],
    authorId: 'aaaaaaaa-1111-4111-8111-aaaaaaaaaa01',
    authorName: 'Otávio',
    publishedAt,
    expiresAt: null,
    archivedAt: null,
    updatedAt: publishedAt,
    unread: false,
    ...extra,
  };
}

describe('ordem dos anúncios', () => {
  it('fixados primeiro, depois os mais recentes e os arquivados por último', () => {
    const ordered = orderAnnouncements([
      announcement('antigo', '2026-10-01T00:00:00.000Z'),
      announcement('arquivado', '2026-10-28T00:00:00.000Z', { archivedAt: '2026-10-28T01:00:00.000Z', pinned: true }),
      announcement('recente', '2026-10-20T00:00:00.000Z'),
      announcement('fixado', '2026-09-01T00:00:00.000Z', { pinned: true }),
    ]);
    expect(ordered.map((item) => item.id)).toEqual(['fixado', 'recente', 'antigo', 'arquivado']);
  });
});

const person = (agentId: string, name: string, role: 'agent' | 'supervisor' | 'admin') => ({ agentId, name, role });
const sectorOf = (id: string, members: ReturnType<typeof person>[], supervisors: ReturnType<typeof person>[]): SectorSummary => ({
  id,
  name: id,
  description: '',
  active: true,
  createdAt: '2026-10-01T00:00:00.000Z',
  canManage: true,
  members,
  supervisors,
});

describe('pessoas dos setores', () => {
  const ana = person('aaaaaaaa-1111-4111-8111-aaaaaaaaaa01', 'Ana', 'agent');
  const bruno = person('aaaaaaaa-1111-4111-8111-aaaaaaaaaa02', 'Bruno', 'agent');
  const sofia = person('aaaaaaaa-1111-4111-8111-aaaaaaaaaa03', 'Sofia', 'supervisor');
  const sectors = [sectorOf('a', [ana], [sofia]), sectorOf('b', [bruno, ana], [])];

  it('junta pessoas sem repetir e em ordem alfabética', () => {
    expect(knownPeople(sectors).map((item) => item.name)).toEqual(['Ana', 'Bruno', 'Sofia']);
  });

  it('lista quem pode entrar no setor e quem pode ser responsável', () => {
    const people = knownPeople(sectors);
    expect(addableMembers(sectors[0] as SectorSummary, people).map((item) => item.name)).toEqual(['Bruno', 'Sofia']);
    expect(supervisorCandidates(sectors[0] as SectorSummary, people).map((item) => item.name)).toEqual(['Sofia']);
  });
});

describe('filtros de agentes', () => {
  const agent = (name: string, sectors: string[], presence: SupervisorAgent['presence'], activityName: string | null): SupervisorAgent => ({
    agentId: `aaaaaaaa-1111-4111-8111-${name.padEnd(12, '0').slice(0, 12)}`,
    name,
    sectors,
    presence,
    activityName,
    activityStartedAt: null,
    activeConversations: 0,
    updatedAt: '2026-10-29T10:00:00.000Z',
    connected: presence !== 'offline',
  });
  const agents = [
    agent('Ana', ['Suporte'], 'available', null),
    agent('Bruno', ['Suporte', 'Vendas'], 'busy', 'Treinamento'),
    agent('Carla', ['Vendas'], 'offline', null),
  ];

  it('combina setor, presença e atividade', () => {
    expect(filterAgents(agents, { sector: 'Vendas', presence: '', activity: '' }).map((item) => item.name)).toEqual(['Bruno', 'Carla']);
    expect(filterAgents(agents, { sector: 'Vendas', presence: 'busy', activity: '' }).map((item) => item.name)).toEqual(['Bruno']);
    expect(filterAgents(agents, { sector: '', presence: '', activity: 'Treinamento' }).map((item) => item.name)).toEqual(['Bruno']);
    expect(filterAgents(agents, { sector: '', presence: '', activity: '' })).toHaveLength(3);
  });

  it('lista setores e atividades distintos', () => {
    expect(distinctSectors(agents)).toEqual(['Suporte', 'Vendas']);
    expect(distinctActivities(agents)).toEqual(['Treinamento']);
  });
});
