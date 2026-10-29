import type { ActivityAuthority, AgentAdmin, AgentPlacement, CompanyCommand, Role } from '@viavoip/protocol';

export type AgentDraft = {
  role: Role;
  queueIds: string[];
  authority: ActivityAuthority['kind'];
};

export function placementOf(draft: AgentDraft): AgentPlacement {
  if (draft.role === 'agent') {
    return { role: 'agent', queueIds: draft.queueIds, activityAuthority: { kind: draft.authority } };
  }
  return { role: draft.role };
}

function sameSet(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((id) => right.includes(id));
}

/**
 * Menor conjunto de comandos para levar o usuário ao estado do formulário:
 * mudança de papel envia a lotação completa; sem mudança de papel, filas e autoridade viram comandos próprios.
 */
export function editCommands(agent: AgentAdmin, draft: AgentDraft): CompanyCommand[] {
  const current = agent.placement;
  if (current.role !== draft.role) {
    return [{ kind: 'agent.role_change', agentId: agent.agentId, placement: placementOf(draft) }];
  }
  if (current.role !== 'agent' || draft.role !== 'agent') return [];
  const commands: CompanyCommand[] = [];
  if (!sameSet(current.queueIds, draft.queueIds)) {
    commands.push({ kind: 'agent.queues_replace', agentId: agent.agentId, queueIds: draft.queueIds });
  }
  if (current.activityAuthority.kind !== draft.authority) {
    commands.push({ kind: 'agent.activity_authority', agentId: agent.agentId, activityAuthority: { kind: draft.authority } });
  }
  return commands;
}
