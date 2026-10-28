import type { ConversationSummary, MessageRecord, QueuePosition, SurveyPrompt } from '@viavoip/protocol';
import type { Pool, PoolClient } from 'pg';
import { withTenant } from '../db/tenant.js';
import { assertCanRead, assertSupervisorQueueAccess, isStaff } from '../domain/access.js';
import { resolveAcceptance } from '../domain/acceptance.js';
import { DomainError } from '../domain/errors.js';
import type { AgentPrincipal, ConversationRecord, Principal, VisitorPrincipal } from '../domain/types.js';
import { listMessages, loadActiveSurvey } from './messages.js';
import { PresenceService } from './presence.js';
import { addEvent, listEvents, loadConversation } from './queries.js';
import { conversationColumns, conversationJoins, mapConversation, toSummary, type ConversationRow } from './rows.js';

export type Snapshot = {
  conversation: ConversationSummary;
  messages: MessageRecord[];
  events: Awaited<ReturnType<typeof listEvents>>;
  survey: SurveyPrompt | null;
};

export type HistoryResult = Snapshot & {
  lastReadMessageId: string | null;
};

export type StartResult = Snapshot & { created: boolean; positions: QueuePosition[] };

export class ConversationService {
  constructor(
    private readonly pool: Pool,
    private readonly presence: PresenceService,
  ) {}

  async start(principal: VisitorPrincipal, queueId: string, displayName?: string): Promise<StartResult> {
    return withTenant(this.pool, principal.tenantId, async (client) => {
      await client.query(`SELECT id FROM visitors WHERE id = $1 AND tenant_id = $2 FOR UPDATE`, [
        principal.visitorId,
        principal.tenantId,
      ]);
      const existing = await loadOpen(client, principal);
      if (existing) {
        return {
          created: false,
          ...(await snapshot(client, principal.tenantId, existing)),
          positions: await positionsFor(client, principal.tenantId, [existing.queueId], existing),
        };
      }
      const site = await client.query<{
        require_visitor_name: boolean;
        acceptance: 'accepting' | 'paused';
        pause_reason: string | null;
        time_zone: string;
      }>(
        `SELECT site.require_visitor_name, site.acceptance, site.pause_reason, tenant.time_zone
         FROM sites AS site
         JOIN tenants AS tenant ON tenant.id = site.tenant_id
         WHERE site.id = $1 AND site.tenant_id = $2`,
        [principal.siteId, principal.tenantId],
      );
      const settings = site.rows[0];
      if (!settings) throw new DomainError('not_found', 'Site não encontrado');
      const windows = await client.query<{ weekday: number; start_minute: number; end_minute: number }>(
        `SELECT weekday, start_minute, end_minute
         FROM site_service_windows
         WHERE site_id = $1 AND tenant_id = $2
         ORDER BY weekday, start_minute`,
        [principal.siteId, principal.tenantId],
      );
      const effective = resolveAcceptance(
        settings.acceptance === 'paused'
          ? { kind: 'paused', reason: settings.pause_reason ?? 'Suspenso' }
          : { kind: 'accepting' },
        windows.rows.length === 0
          ? { kind: 'always_open' }
          : {
              kind: 'weekly',
              windows: windows.rows.map((window) => ({
                weekday: window.weekday,
                startMinute: window.start_minute,
                endMinute: window.end_minute,
              })),
            },
        settings.time_zone,
        new Date().toISOString(),
      );
      if (effective.kind !== 'accepting') throw new DomainError('invalid_state', 'Atendimento indisponível');
      if (settings.require_visitor_name && !displayName) {
        throw new DomainError('invalid_payload', 'Informe seu nome para entrar na fila');
      }
      if (displayName) {
        await client.query(
          `UPDATE visitors SET display_name = $3 WHERE id = $1 AND tenant_id = $2`,
          [principal.visitorId, principal.tenantId, displayName],
        );
      }
      const inserted = await client.query<{ id: string }>(
        `INSERT INTO conversations (tenant_id, site_id, queue_id, visitor_id, status, queued_at)
         SELECT $1, $2, queue.id, $3, 'queued', now()
         FROM queues AS queue
         JOIN site_queues AS site_queue
           ON site_queue.queue_id = queue.id
          AND site_queue.site_id = $2
          AND site_queue.tenant_id = $1
         WHERE queue.id = $4 AND queue.tenant_id = $1
         RETURNING id`,
        [principal.tenantId, principal.siteId, principal.visitorId, queueId],
      );
      const conversationId = inserted.rows[0]?.id;
      if (!conversationId) throw new DomainError('not_found', 'Fila indisponível neste site');
      await addEvent(client, principal.tenantId, conversationId, 'queued', { queueId });
      const conversation = await mustLoad(client, conversationId, principal.tenantId);
      return {
        created: true,
        ...(await snapshot(client, principal.tenantId, conversation)),
        positions: await positionsFor(client, principal.tenantId, [conversation.queueId], conversation),
      };
    });
  }

  async leave(
    principal: VisitorPrincipal,
    conversationId: string,
  ): Promise<{ conversation: ConversationSummary; positions: QueuePosition[] }> {
    return withTenant(this.pool, principal.tenantId, async (client) => {
      const current = await loadConversation(client, conversationId, principal.tenantId, true);
      if (!current || current.visitorId !== principal.visitorId || current.siteId !== principal.siteId) {
        throw new DomainError('not_found', 'Conversa não encontrada');
      }
      if (current.status !== 'queued') throw new DomainError('invalid_state', 'Conversa não está na fila');
      const updated = await client.query(
        `UPDATE conversations
         SET status = 'closed', ended_at = now(), version = version + 1
         WHERE id = $1 AND tenant_id = $2 AND visitor_id = $3 AND status = 'queued'
         RETURNING id`,
        [conversationId, principal.tenantId, principal.visitorId],
      );
      if (!updated.rows[0]) throw new DomainError('invalid_state', 'Conversa não está na fila');
      await addEvent(client, principal.tenantId, conversationId, 'left', { queueId: current.queueId });
      const conversation = toSummary(await mustLoad(client, conversationId, principal.tenantId));
      return {
        conversation,
        positions: await positionsFor(client, principal.tenantId, [current.queueId], {
          id: conversationId,
          queueId: current.queueId,
          status: 'closed',
        }),
      };
    });
  }

  async claim(
    principal: AgentPrincipal,
    conversationId: string,
  ): Promise<{ conversation: ConversationSummary; siteId: string; positions: QueuePosition[] }> {
    if (principal.kind !== 'agent') throw new DomainError('forbidden', 'Somente agentes assumem conversas');
    return withTenant(this.pool, principal.tenantId, async (client) => {
      await this.presence.lockAndAssertCanClaim(client, principal);
      const updated = await client.query(
        `UPDATE conversations AS conversation
         SET status = 'assigned',
             agent_id = $2,
             assigned_at = now(),
             version = conversation.version + 1
         WHERE conversation.id = $1
           AND conversation.tenant_id = $3
           AND conversation.status = 'queued'
           AND conversation.agent_id IS NULL
           AND conversation.queue_id IN (
             SELECT agent_queue.queue_id
             FROM agent_queues AS agent_queue
             WHERE agent_queue.agent_id = $2 AND agent_queue.tenant_id = $3
           )
         RETURNING conversation.id`,
        [conversationId, principal.agentId, principal.tenantId],
      );
      if (!updated.rows[0]) await explainClaimFailure(client, principal, conversationId);
      await addEvent(client, principal.tenantId, conversationId, 'assigned', { agentId: principal.agentId });
      const record = await mustLoad(client, conversationId, principal.tenantId);
      return {
        conversation: toSummary(record),
        siteId: record.siteId,
        positions: await positionsFor(client, principal.tenantId, [record.queueId], record),
      };
    });
  }

  async release(
    principal: AgentPrincipal,
    conversationId: string,
  ): Promise<{ conversation: ConversationSummary; siteId: string; positions: QueuePosition[] }> {
    if (principal.kind !== 'agent') throw new DomainError('forbidden', 'Somente agentes devolvem conversas');
    return withTenant(this.pool, principal.tenantId, async (client) => {
      const current = await loadConversation(client, conversationId, principal.tenantId, true);
      if (!current) throw new DomainError('not_found', 'Conversa não encontrada');
      if (current.status !== 'assigned') throw new DomainError('invalid_state', 'Conversa não está em atendimento');
      if (current.agentId !== principal.agentId) {
        throw new DomainError('forbidden', 'Conversa atribuída a outro agente');
      }
      const updated = await client.query(
        `UPDATE conversations AS conversation
         SET status = 'queued',
             agent_id = NULL,
             assigned_at = NULL,
             queued_at = now(),
             version = conversation.version + 1
         WHERE conversation.id = $1
           AND conversation.tenant_id = $2
           AND conversation.status = 'assigned'
           AND conversation.agent_id = $3
           AND conversation.version = $4
         RETURNING conversation.id`,
        [conversationId, principal.tenantId, principal.agentId, current.version],
      );
      if (!updated.rows[0]) throw new DomainError('conflict', 'A conversa mudou. Atualize e tente de novo.');
      await addEvent(client, principal.tenantId, conversationId, 'released', { agentId: principal.agentId });
      const record = await mustLoad(client, conversationId, principal.tenantId);
      return {
        conversation: toSummary(record),
        siteId: record.siteId,
        positions: await positionsFor(client, principal.tenantId, [record.queueId], record),
      };
    });
  }

  async transfer(
    principal: AgentPrincipal,
    conversationId: string,
    queueId: string,
  ): Promise<{
    conversation: ConversationSummary;
    previousQueueId: string;
    releasedAgentId: string | null;
    siteId: string;
    positions: QueuePosition[];
  }> {
    return withTenant(this.pool, principal.tenantId, async (client) => {
      const current = await loadConversation(client, conversationId, principal.tenantId, true);
      if (!current) throw new DomainError('not_found', 'Conversa não encontrada');
      if (principal.kind === 'supervisor' || principal.kind === 'admin') {
        await assertSupervisorQueueAccess(client, principal, current.queueId);
      }
      assertCanTransfer(principal, current);
      const queue = await client.query(
        `SELECT id FROM queues WHERE id = $1 AND tenant_id = $2`,
        [queueId, principal.tenantId],
      );
      if (!queue.rows[0]) throw new DomainError('not_found', 'Fila não encontrada');
      if (principal.kind === 'agent') {
        const member = await client.query(
          `SELECT 1 FROM agent_queues WHERE agent_id = $1 AND queue_id = $2 AND tenant_id = $3`,
          [principal.agentId, queueId, principal.tenantId],
        );
        if (!member.rows[0]) throw new DomainError('forbidden', 'Fila de destino não autorizada');
      } else if (principal.kind === 'supervisor') {
        await assertSupervisorQueueAccess(client, principal, queueId);
      }
      const updated = await client.query(
        `UPDATE conversations
         SET queue_id = $2,
             agent_id = NULL,
             status = 'queued',
             assigned_at = NULL,
             queued_at = now(),
             version = version + 1
         WHERE id = $1
           AND tenant_id = $3
           AND version = $4
           AND status = $5
           AND agent_id IS NOT DISTINCT FROM $6
         RETURNING id`,
        [conversationId, queueId, principal.tenantId, current.version, current.status, current.agentId],
      );
      if (!updated.rows[0]) throw new DomainError('conflict', 'A conversa mudou. Atualize e tente de novo.');
      await addEvent(client, principal.tenantId, conversationId, 'transferred', {
        fromQueueId: current.queueId,
        toQueueId: queueId,
      });
      const record = await mustLoad(client, conversationId, principal.tenantId);
      return {
        conversation: toSummary(record),
        previousQueueId: current.queueId,
        releasedAgentId: current.agentId,
        siteId: record.siteId,
        positions: await positionsFor(client, principal.tenantId, [current.queueId, queueId], record),
      };
    });
  }

  async close(
    principal: AgentPrincipal,
    conversationId: string,
    dispositionId: string,
  ): Promise<{ conversation: ConversationSummary; survey: SurveyPrompt; siteId: string; applied: boolean }> {
    if (principal.kind !== 'agent') throw new DomainError('forbidden', 'Somente o agente encerra o atendimento');
    return withTenant(this.pool, principal.tenantId, async (client) => {
      const current = await loadConversation(client, conversationId, principal.tenantId, true);
      if (!current) throw new DomainError('not_found', 'Conversa não encontrada');
      if (current.agentId !== principal.agentId) {
        throw new DomainError('forbidden', 'Conversa atribuída a outro agente');
      }
      const survey = await loadActiveSurvey(client, principal.tenantId);
      if (!survey) throw new DomainError('invalid_state', 'Pesquisa ativa não configurada');
      const prompt = { prompt: survey.prompt, scale: survey.scale, commentEnabled: survey.commentEnabled };
      if (current.status === 'awaiting_survey') {
        if (current.dispositionId === dispositionId) {
          return { conversation: toSummary(current), siteId: current.siteId, survey: prompt, applied: false };
        }
        throw new DomainError('conflict', 'Atendimento já classificado');
      }
      if (current.status !== 'assigned') throw new DomainError('invalid_state', 'Conversa não está em atendimento');
      const disposition = await client.query(
        `SELECT id FROM dispositions WHERE id = $1 AND tenant_id = $2`,
        [dispositionId, principal.tenantId],
      );
      if (!disposition.rows[0]) throw new DomainError('not_found', 'Classificação não encontrada');
      const updated = await client.query(
        `UPDATE conversations
         SET status = 'awaiting_survey',
             disposition_id = $2,
             ended_at = now(),
             version = version + 1
         WHERE id = $1
           AND tenant_id = $3
           AND status = 'assigned'
           AND agent_id = $4
           AND version = $5
         RETURNING id`,
        [conversationId, dispositionId, principal.tenantId, principal.agentId, current.version],
      );
      if (!updated.rows[0]) throw new DomainError('conflict', 'A conversa mudou. Atualize e tente de novo.');
      await addEvent(client, principal.tenantId, conversationId, 'classified', { dispositionId });
      const record = await mustLoad(client, conversationId, principal.tenantId);
      return {
        conversation: toSummary(record),
        siteId: record.siteId,
        survey: prompt,
        applied: true,
      };
    });
  }

  async submitSurvey(
    principal: VisitorPrincipal,
    input: { conversationId: string; score: number; comment?: string },
  ): Promise<ConversationSummary> {
    return withTenant(this.pool, principal.tenantId, async (client) => {
      const current = await loadConversation(client, input.conversationId, principal.tenantId, true);
      if (!current) throw new DomainError('not_found', 'Conversa não encontrada');
      if (current.visitorId !== principal.visitorId || current.siteId !== principal.siteId) {
        throw new DomainError('not_found', 'Conversa não encontrada');
      }
      if (current.status !== 'awaiting_survey') {
        throw new DomainError('invalid_state', 'Pesquisa indisponível para esta conversa');
      }
      const survey = await loadActiveSurvey(client, principal.tenantId);
      if (!survey) throw new DomainError('invalid_state', 'Pesquisa ativa não configurada');
      if (input.score > survey.scale) throw new DomainError('invalid_payload', 'Nota fora da escala');
      const comment = input.comment?.trim();
      try {
        await client.query(
          `INSERT INTO survey_responses (tenant_id, conversation_id, survey_definition_id, score, comment)
           VALUES ($1, $2, $3, $4, $5)`,
          [principal.tenantId, input.conversationId, survey.id, input.score, comment ? comment : null],
        );
      } catch (error) {
        if (isUniqueViolation(error)) throw new DomainError('conflict', 'Pesquisa já respondida');
        throw error;
      }
      await client.query(
        `UPDATE conversations
         SET status = 'closed', version = version + 1
         WHERE id = $1 AND tenant_id = $2 AND status = 'awaiting_survey'`,
        [input.conversationId, principal.tenantId],
      );
      await addEvent(client, principal.tenantId, input.conversationId, 'survey_submitted', {
        score: String(input.score),
      });
      await addEvent(client, principal.tenantId, input.conversationId, 'closed', { surveyId: survey.id });
      return toSummary(await mustLoad(client, input.conversationId, principal.tenantId));
    });
  }

  async history(
    principal: Principal,
    conversationId: string,
    cursor: { afterMessageId?: string; afterEventId?: string } = {},
    auditAction?: string,
  ): Promise<HistoryResult> {
    return withTenant(this.pool, principal.tenantId, async (client) => {
      const conversation = await loadConversation(client, conversationId, principal.tenantId, false);
      if (!conversation) throw new DomainError('not_found', 'Conversa não encontrada');
      await assertCanRead(client, principal, conversation);
      if (auditAction && principal.kind !== 'visitor') {
        await client.query(
          `INSERT INTO audit_events (tenant_id, actor_id, action, resource_type, resource_id)
           VALUES ($1, $2, $3, 'conversation', $4)`,
          [principal.tenantId, principal.agentId, auditAction, conversationId],
        );
      }
      const view = await snapshot(client, principal.tenantId, conversation, cursor.afterMessageId, cursor.afterEventId);
      return {
        ...view,
        lastReadMessageId: await readCursor(client, principal, conversationId),
      };
    });
  }

  async markRead(
    principal: AgentPrincipal,
    conversationId: string,
    messageId: string,
  ): Promise<{ advanced: boolean }> {
    if (principal.kind !== 'agent') throw new DomainError('forbidden', 'Somente agentes marcam leitura');
    return withTenant(this.pool, principal.tenantId, async (client) => {
      const conversation = await loadConversation(client, conversationId, principal.tenantId, false);
      if (!conversation) throw new DomainError('not_found', 'Conversa não encontrada');
      await assertCanRead(client, principal, conversation);
      const message = await client.query(
        `SELECT id FROM messages WHERE id = $1 AND conversation_id = $2 AND tenant_id = $3`,
        [messageId, conversationId, principal.tenantId],
      );
      if (!message.rows[0]) throw new DomainError('invalid_payload', 'Mensagem não encontrada');
      const updated = await client.query(
        `INSERT INTO conversation_reads (conversation_id, agent_id, tenant_id, last_read_message_id)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (conversation_id, agent_id) DO UPDATE
         SET last_read_message_id = EXCLUDED.last_read_message_id,
             read_at = now()
         WHERE (
           SELECT ROW(created_at, id)
           FROM messages
           WHERE id = conversation_reads.last_read_message_id
             AND conversation_id = conversation_reads.conversation_id
             AND tenant_id = conversation_reads.tenant_id
         ) < (
           SELECT ROW(created_at, id)
           FROM messages
           WHERE id = EXCLUDED.last_read_message_id
             AND conversation_id = EXCLUDED.conversation_id
             AND tenant_id = EXCLUDED.tenant_id
         )
         RETURNING conversation_id`,
        [conversationId, principal.agentId, principal.tenantId, messageId],
      );
      return { advanced: Boolean(updated.rows[0]) };
    });
  }

  async listForAgent(principal: AgentPrincipal): Promise<ConversationSummary[]> {
    if (principal.kind !== 'agent') throw new DomainError('forbidden', 'Lista exclusiva do agente');
    return withTenant(this.pool, principal.tenantId, async (client) => {
      const result = await client.query<ConversationRow>(
        `SELECT ${conversationColumns}
         FROM conversations AS conversation
         ${conversationJoins}
         WHERE conversation.tenant_id = $2
           AND conversation.status IN ('queued', 'assigned', 'awaiting_survey')
           AND (
             conversation.agent_id = $1
             OR (
               conversation.status = 'queued'
               AND conversation.queue_id IN (
                 SELECT agent_queue.queue_id
                 FROM agent_queues AS agent_queue
                 WHERE agent_queue.agent_id = $1 AND agent_queue.tenant_id = $2
               )
             )
           )
         ORDER BY conversation.created_at ASC`,
        [principal.agentId, principal.tenantId],
      );
      return result.rows.map((row) => toSummary(mapConversation(row)));
    });
  }

  async listForSupervisor(principal: AgentPrincipal): Promise<ConversationSummary[]> {
    if (!isStaff(principal.kind)) throw new DomainError('forbidden', 'Lista exclusiva do supervisor');
    return withTenant(this.pool, principal.tenantId, async (client) => {
      const result = await client.query<ConversationRow>(
        `SELECT ${conversationColumns}
         FROM conversations AS conversation
         ${conversationJoins}
         WHERE conversation.tenant_id = $1
           AND conversation.status IN ('queued', 'assigned', 'awaiting_survey')
           AND (
             $2::boolean
             OR conversation.queue_id IN (
               SELECT sector_queue.queue_id
               FROM sector_supervisors AS lead
               JOIN sectors AS sector ON sector.id = lead.sector_id AND sector.tenant_id = lead.tenant_id
               JOIN sector_queues AS sector_queue ON sector_queue.sector_id = sector.id AND sector_queue.tenant_id = sector.tenant_id
               WHERE lead.tenant_id = $1 AND lead.agent_id = $3
                 AND lead.removed_at IS NULL AND sector.active = true
             )
           )
         ORDER BY conversation.created_at ASC`,
        [principal.tenantId, principal.kind === 'admin', principal.agentId],
      );
      return result.rows.map((row) => toSummary(mapConversation(row)));
    });
  }

  async openConversation(principal: VisitorPrincipal): Promise<ConversationRecord | null> {
    return withTenant(this.pool, principal.tenantId, async (client) => loadOpen(client, principal));
  }

  async queueIdsForAgent(principal: AgentPrincipal): Promise<string[]> {
    return withTenant(this.pool, principal.tenantId, async (client) => {
      const result = await client.query<{ queue_id: string }>(
        `SELECT queue_id FROM agent_queues WHERE agent_id = $1 AND tenant_id = $2`,
        [principal.agentId, principal.tenantId],
      );
      return result.rows.map((row) => row.queue_id);
    });
  }

  async queueIdsForSupervisor(principal: AgentPrincipal): Promise<string[]> {
    return withTenant(this.pool, principal.tenantId, async (client) => {
      const result = principal.kind === 'admin'
        ? await client.query<{ queue_id: string }>(
            `SELECT id AS queue_id FROM queues WHERE tenant_id = $1`,
            [principal.tenantId],
          )
        : await client.query<{ queue_id: string }>(
            `SELECT DISTINCT sector_queue.queue_id
             FROM sector_supervisors AS lead
             JOIN sectors AS sector ON sector.id = lead.sector_id AND sector.tenant_id = lead.tenant_id
             JOIN sector_queues AS sector_queue ON sector_queue.sector_id = sector.id AND sector_queue.tenant_id = sector.tenant_id
             WHERE lead.tenant_id = $1 AND lead.agent_id = $2
               AND lead.removed_at IS NULL AND sector.active = true`,
            [principal.tenantId, principal.agentId],
          );
      return result.rows.map((row) => row.queue_id);
    });
  }

  async queueIdForConversation(principal: AgentPrincipal, conversationId: string): Promise<string> {
    return withTenant(this.pool, principal.tenantId, async (client) => {
      const result = await client.query<{ queue_id: string }>(
        `SELECT queue_id FROM conversations WHERE id = $1 AND tenant_id = $2`,
        [conversationId, principal.tenantId],
      );
      const queueId = result.rows[0]?.queue_id;
      if (!queueId) throw new DomainError('not_found', 'Conversa não encontrada');
      return queueId;
    });
  }
}

async function loadOpen(client: PoolClient, principal: VisitorPrincipal): Promise<ConversationRecord | null> {
  const result = await client.query<ConversationRow>(
    `SELECT ${conversationColumns}
     FROM conversations AS conversation
     ${conversationJoins}
     WHERE conversation.visitor_id = $1
       AND conversation.tenant_id = $2
       AND conversation.site_id = $3
       AND conversation.status <> 'closed'
     ORDER BY conversation.created_at DESC
     LIMIT 1`,
    [principal.visitorId, principal.tenantId, principal.siteId],
  );
  const row = result.rows[0];
  return row ? mapConversation(row) : null;
}

async function mustLoad(client: PoolClient, conversationId: string, tenantId: string): Promise<ConversationRecord> {
  const conversation = await loadConversation(client, conversationId, tenantId, false);
  if (!conversation) throw new DomainError('internal', 'Conversa desapareceu durante a transação');
  return conversation;
}

async function snapshot(
  client: PoolClient,
  tenantId: string,
  conversation: ConversationRecord,
  afterMessageId?: string,
  afterEventId?: string,
): Promise<Snapshot> {
  const messages = await listMessages(client, conversation.id, tenantId, afterMessageId);
  const events = await listEvents(client, conversation.id, tenantId, afterEventId);
  const survey = conversation.status === 'awaiting_survey' ? await loadActiveSurvey(client, tenantId) : null;
  return {
    conversation: toSummary(conversation),
    messages,
    events,
    survey: survey
      ? { prompt: survey.prompt, scale: survey.scale, commentEnabled: survey.commentEnabled }
      : null,
  };
}

async function positionsFor(
  client: PoolClient,
  tenantId: string,
  queueIds: string[],
  focus: { id: string; queueId: string; status: string },
): Promise<QueuePosition[]> {
  const uniqueQueues = [...new Set(queueIds)];
  const queued: QueuePosition[] = [];
  for (const queueId of uniqueQueues) {
    const result = await client.query<{ id: string; position: number }>(
      `SELECT id, row_number() OVER (ORDER BY created_at ASC, id ASC)::int AS position
       FROM conversations
       WHERE tenant_id = $1 AND queue_id = $2 AND status = 'queued'`,
      [tenantId, queueId],
    );
    for (const row of result.rows) {
      queued.push({ conversationId: row.id, queueId, position: Number(row.position) });
    }
  }
  if (focus.status === 'queued' || queued.some((item) => item.conversationId === focus.id)) return queued;
  return [...queued, { conversationId: focus.id, queueId: focus.queueId, position: null }];
}

function assertCanTransfer(principal: AgentPrincipal, conversation: ConversationRecord): void {
  switch (principal.kind) {
    case 'agent':
      if (conversation.agentId !== principal.agentId || conversation.status !== 'assigned') {
        throw new DomainError('forbidden', 'Agente não pode transferir esta conversa');
      }
      return;
    case 'supervisor':
    case 'admin':
      if (conversation.status !== 'assigned' && conversation.status !== 'queued') {
        throw new DomainError('invalid_state', 'Conversa não pode ser transferida');
      }
      return;
    default: {
      const neverKind: never = principal.kind;
      throw new DomainError('forbidden', `Papel inesperado: ${String(neverKind)}`);
    }
  }
}

async function explainClaimFailure(
  client: PoolClient,
  principal: AgentPrincipal,
  conversationId: string,
): Promise<never> {
  const visible = await client.query<{ status: string; queue_id: string }>(
    `SELECT status, queue_id FROM conversations WHERE id = $1 AND tenant_id = $2`,
    [conversationId, principal.tenantId],
  );
  const row = visible.rows[0];
  if (!row) throw new DomainError('not_found', 'Conversa não encontrada');
  const member = await client.query(
    `SELECT 1 FROM agent_queues WHERE agent_id = $1 AND queue_id = $2 AND tenant_id = $3`,
    [principal.agentId, row.queue_id, principal.tenantId],
  );
  if (!member.rows[0]) throw new DomainError('forbidden', 'Agente sem acesso à fila');
  if (row.status === 'assigned') throw new DomainError('already_claimed', 'Conversa já assumida');
  throw new DomainError('invalid_state', 'Conversa não está aguardando');
}

async function readCursor(client: PoolClient, principal: Principal, conversationId: string): Promise<string | null> {
  if (principal.kind !== 'agent') return null;
  const result = await client.query<{ last_read_message_id: string }>(
    `SELECT last_read_message_id
     FROM conversation_reads
     WHERE conversation_id = $1 AND agent_id = $2 AND tenant_id = $3`,
    [conversationId, principal.agentId, principal.tenantId],
  );
  return result.rows[0]?.last_read_message_id ?? null;
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === '23505';
}
