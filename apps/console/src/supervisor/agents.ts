import type { SupervisorAgent } from '@viavoip/protocol';

export type AgentFilters = { sector: string; presence: string; activity: string };

export function filterAgents(agents: SupervisorAgent[], filters: AgentFilters): SupervisorAgent[] {
  return agents.filter((agent) => {
    if (filters.sector && !agent.sectors.includes(filters.sector)) return false;
    if (filters.presence && agent.presence !== filters.presence) return false;
    if (filters.activity && agent.activityName !== filters.activity) return false;
    return true;
  });
}

export function distinctSectors(agents: SupervisorAgent[]): string[] {
  return [...new Set(agents.flatMap((agent) => agent.sectors))].sort((left, right) => left.localeCompare(right, 'pt-BR'));
}

export function distinctActivities(agents: SupervisorAgent[]): string[] {
  return [...new Set(agents.flatMap((agent) => (agent.activityName ? [agent.activityName] : [])))].sort((left, right) =>
    left.localeCompare(right, 'pt-BR'),
  );
}
