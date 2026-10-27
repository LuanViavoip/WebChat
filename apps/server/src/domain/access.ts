import type { PoolClient } from 'pg';
import { DomainError } from './errors.js';
import type { AgentPrincipal, ConversationRecord, Principal, VisitorPrincipal } from './types.js';

export function isStaff(kind: AgentPrincipal['kind']): boolean {
  switch (kind) {
    case 'agent':
      return false;
    case 'supervisor':
    case 'admin':
      return true;
    default: {
      const unexpected: never = kind;
      throw new DomainError('forbidden', `Papel inesperado: ${String(unexpected)}`);
    }
  }
}

export async function assertCanRead(
  client: PoolClient,
  principal: Principal,
  conversation: ConversationRecord,
): Promise<void> {
  switch (principal.kind) {
    case 'visitor':
      assertVisitorOwns(principal, conversation);
      return;
    case 'agent':
      if (conversation.agentId === principal.agentId) return;
      if (conversation.status === 'queued' && (await agentServesQueue(client, principal, conversation.queueId))) {
        return;
      }
      throw new DomainError('forbidden', 'Conversa fora do escopo do agente');
    case 'supervisor':
      await assertSupervisorQueueAccess(client, principal, conversation.queueId);
      return;
    case 'admin':
      return;
    default: {
      const neverPrincipal: never = principal;
      throw new DomainError('forbidden', `Principal inesperado: ${String(neverPrincipal)}`);
    }
  }
}

export async function assertSupervisorQueueAccess(
  client: PoolClient,
  principal: AgentPrincipal,
  queueId: string,
): Promise<void> {
  if (principal.kind === 'admin') return;
  if (principal.kind !== 'supervisor') throw new DomainError('forbidden', 'Escopo exclusivo da supervisão');
  const result = await client.query(
    `SELECT 1
     FROM sector_supervisors AS lead
     JOIN sectors AS sector
       ON sector.id = lead.sector_id AND sector.tenant_id = lead.tenant_id
     JOIN sector_queues AS sector_queue
       ON sector_queue.sector_id = sector.id AND sector_queue.tenant_id = sector.tenant_id
     WHERE lead.tenant_id = $1
       AND lead.agent_id = $2
       AND lead.removed_at IS NULL
       AND sector.active = true
       AND sector_queue.queue_id = $3`,
    [principal.tenantId, principal.agentId, queueId],
  );
  if (!result.rows[0]) throw new DomainError('forbidden', 'Conversa fora do escopo do supervisor');
}

export function assertCanSend(principal: Principal, conversation: ConversationRecord): void {
  switch (principal.kind) {
    case 'visitor':
      assertVisitorOwns(principal, conversation);
      if (conversation.status !== 'queued' && conversation.status !== 'assigned') {
        throw new DomainError('invalid_state', 'Conversa encerrada para novas mensagens');
      }
      return;
    case 'agent':
      if (conversation.agentId !== principal.agentId) {
        throw new DomainError('forbidden', 'Conversa atribuída a outro agente');
      }
      if (conversation.status !== 'assigned') {
        throw new DomainError('invalid_state', 'Conversa não está em atendimento');
      }
      return;
    case 'supervisor':
    case 'admin':
      throw new DomainError('forbidden', 'Supervisor não envia mensagens neste canal');
    default: {
      const neverPrincipal: never = principal;
      throw new DomainError('forbidden', `Principal inesperado: ${String(neverPrincipal)}`);
    }
  }
}

function assertVisitorOwns(principal: VisitorPrincipal, conversation: ConversationRecord): void {
  if (conversation.visitorId !== principal.visitorId || conversation.siteId !== principal.siteId) {
    throw new DomainError('not_found', 'Conversa não encontrada');
  }
}

async function agentServesQueue(
  client: PoolClient,
  principal: AgentPrincipal,
  queueId: string,
): Promise<boolean> {
  const result = await client.query(
    `SELECT 1
     FROM agent_queues
     WHERE agent_id = $1 AND queue_id = $2 AND tenant_id = $3`,
    [principal.agentId, queueId, principal.tenantId],
  );
  return Boolean(result.rows[0]);
}
