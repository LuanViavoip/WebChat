import type { Role, SectorSummary } from '@viavoip/protocol';

export type Person = { agentId: string; name: string; role: Role };

/** Pessoas conhecidas a partir dos setores listados (membros e responsáveis), sem repetição. */
export function knownPeople(sectors: SectorSummary[]): Person[] {
  const byId = new Map<string, Person>();
  for (const sector of sectors) {
    for (const person of [...sector.members, ...sector.supervisors]) byId.set(person.agentId, person);
  }
  return [...byId.values()].sort((left, right) => left.name.localeCompare(right.name, 'pt-BR'));
}

/** Quem ainda não é membro do setor e pode ser incluído. */
export function addableMembers(sector: SectorSummary, people: Person[]): Person[] {
  const members = new Set(sector.members.map((person) => person.agentId));
  return people.filter((person) => !members.has(person.agentId));
}

/** Candidatos a responsável: supervisores e administradores conhecidos, mais os atuais. */
export function supervisorCandidates(sector: SectorSummary, people: Person[]): Person[] {
  const current = new Set(sector.supervisors.map((person) => person.agentId));
  return people.filter((person) => person.role !== 'agent' || current.has(person.agentId));
}
