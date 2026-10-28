import {
  qualityReportSchema,
  type QualityQuery,
  type QualityReport,
  type QualityScope,
} from '@viavoip/protocol';
import type { Pool, PoolClient } from 'pg';
import { withTenant } from '../db/tenant.js';
import { assertCompanyAccess } from '../domain/company-access.js';
import { DomainError } from '../domain/errors.js';
import {
  judgeFirstResponse,
  judgeQueueWait,
  policyAt,
  reconstructOperationalFacts,
  type ConversationTimelineEvent,
  type FirstResponseFact,
  type QueueWaitFact,
  type SlaJudgement,
  type SlaPolicyVersion,
} from '../domain/quality-facts.js';
import type { AgentPrincipal } from '../domain/types.js';

const maxWindowMs = 31 * 24 * 60 * 60 * 1000;

export class OperationalQualityService {
  constructor(private readonly pool: Pool) {}

  async report(principal: AgentPrincipal, query: QualityQuery): Promise<QualityReport> {
    const span = Date.parse(query.to) - Date.parse(query.from);
    if (!Number.isFinite(span) || span <= 0 || span > maxWindowMs) {
      throw new DomainError('invalid_payload', 'Período inválido');
    }
    return withTenant(this.pool, principal.tenantId, async (client) => {
      await assertCompanyAccess(client, principal, { capability: 'quality.report', scope: query.scope });
      return buildReport(client, principal.tenantId, query);
    });
  }
}

async function buildReport(client: PoolClient, tenantId: string, query: QualityQuery): Promise<QualityReport> {
  const eventScope = scopeFilter(query.scope, 2);
  const windowScope = scopeFilter(query.scope, 4);
  const events = await client.query<{ conversation_id: string; type: string; payload: Record<string, string>; created_at: Date }>(
    `SELECT event.conversation_id, event.type, event.payload, event.created_at
     FROM conversation_events AS event
     JOIN conversations AS conversation ON conversation.id = event.conversation_id AND conversation.tenant_id = event.tenant_id
     WHERE event.tenant_id = $1 ${eventScope.sql}
     ORDER BY event.created_at, event.id`,
    [tenantId, ...eventScope.params],
  );
  const replies = await client.query<{ conversation_id: string; sender_id: string; created_at: Date }>(
    `SELECT message.conversation_id, message.sender_id, message.created_at
     FROM messages AS message
     JOIN conversations AS conversation ON conversation.id = message.conversation_id AND conversation.tenant_id = message.tenant_id
     WHERE message.tenant_id = $1 AND message.sender_type = 'agent' ${eventScope.sql}`,
    [tenantId, ...eventScope.params],
  );
  const policies = await client.query<{
    queue_id: string;
    effective_from: Date;
    retired_at: Date | null;
    queue_wait: number;
    first_response: number;
  }>(
    `SELECT policy.queue_id, policy.effective_from, policy.retired_at,
            wait.threshold_seconds AS queue_wait, reply.threshold_seconds AS first_response
     FROM sla_policies AS policy
     JOIN sla_policy_clocks AS wait ON wait.policy_id = policy.id AND wait.metric = 'queue_wait'
     JOIN sla_policy_clocks AS reply ON reply.policy_id = policy.id AND reply.metric = 'first_response'
     WHERE policy.tenant_id = $1`,
    [tenantId],
  );
  const classified = await client.query<{ total: number }>(
    `SELECT count(*)::int AS total
     FROM conversation_events AS event
     JOIN conversations AS conversation ON conversation.id = event.conversation_id AND conversation.tenant_id = event.tenant_id
     WHERE event.tenant_id = $1 AND event.type = 'classified'
       AND event.created_at >= $2 AND event.created_at < $3 ${windowScope.sql}`,
    [tenantId, query.from, query.to, ...windowScope.params],
  );
  const survey = await client.query<{ score: number; comment: string | null }>(
    `SELECT response.score, response.comment
     FROM survey_responses AS response
     JOIN conversations AS conversation ON conversation.id = response.conversation_id AND conversation.tenant_id = response.tenant_id
     WHERE response.tenant_id = $1 AND response.created_at >= $2 AND response.created_at < $3 ${windowScope.sql}`,
    [tenantId, query.from, query.to, ...windowScope.params],
  );
  const presence = await client.query<{ status: string; started_at: Date; ended_at: Date | null }>(
    `SELECT interval.status, interval.started_at, interval.ended_at
     FROM presence_intervals AS interval
     JOIN agents AS agent ON agent.id = interval.agent_id AND agent.tenant_id = interval.tenant_id
     WHERE interval.tenant_id = $1 AND agent.role = 'agent' ${presenceScope(query.scope).sql}`,
    [tenantId, ...presenceScope(query.scope).params],
  );
  const versions: SlaPolicyVersion[] = policies.rows.map((row) => ({
    queueId: row.queue_id,
    effectiveFrom: row.effective_from.toISOString(),
    retiredAt: row.retired_at ? row.retired_at.toISOString() : null,
    queueWaitThresholdSeconds: row.queue_wait,
    firstResponseThresholdSeconds: row.first_response,
  }));
  const facts = reconstructOperationalFacts({
    events: events.rows.flatMap((row) => {
      if (!isTimelineType(row.type)) return [];
      const event: ConversationTimelineEvent = {
        conversationId: row.conversation_id,
        type: row.type,
        at: row.created_at.toISOString(),
        payload: row.payload ?? {},
      };
      return [event];
    }),
    agentReplies: replies.rows.map((row) => ({
      conversationId: row.conversation_id,
      agentId: row.sender_id,
      at: row.created_at.toISOString(),
    })),
    window: { from: query.from, to: query.to },
  });
  const queueSamples = facts.queueWaits.flatMap((fact) => (fact.kind === 'completed' ? [fact.elapsedSeconds] : []));
  const responseSamples = facts.firstResponses.flatMap((fact) => (fact.kind === 'answered' ? [fact.elapsedSeconds] : []));
  const handleSamples = facts.handleTimes.flatMap((fact) => (fact.kind === 'closed_segment' ? [fact.elapsedSeconds] : []));
  const queueSla = tally(facts.queueWaits.map((fact) => judgeQueueWait(fact, threshold(versions, fact, 'queue_wait'))));
  const responseSla = tally(
    facts.firstResponses.map((fact) => judgeFirstResponse(fact, threshold(versions, fact, 'first_response'))),
  );
  const comments = survey.rows.filter((row) => row.comment && row.comment.trim().length > 0).length;
  const scores = survey.rows.map((row) => row.score);
  return qualityReportSchema.parse({
    scope: query.scope,
    window: { from: query.from, to: query.to },
    queueWait: durationSummary(queueSamples),
    firstResponse: durationSummary(responseSamples),
    handleTime: durationSummary(handleSamples),
    queueWaits: {
      completed: facts.queueWaits.filter((fact) => fact.kind === 'completed').length,
      abandoned: facts.queueWaits.filter((fact) => fact.kind === 'abandoned').length,
      open: facts.queueWaits.filter((fact) => fact.kind === 'open').length,
      unreadable: facts.queueWaits.filter((fact) => fact.kind === 'unreadable').length,
    },
    firstResponseCoverage: {
      answered: facts.firstResponses.filter((fact) => fact.kind === 'answered').length,
      unansweredClosed: facts.firstResponses.filter((fact) => fact.kind === 'closed_without_reply').length,
      transferredUnanswered: facts.firstResponses.filter((fact) => fact.kind === 'handed_off_without_reply').length,
      stillOpen: facts.firstResponses.filter((fact) => fact.kind === 'still_open').length,
      unreadable: facts.firstResponses.filter((fact) => fact.kind === 'unreadable').length,
    },
    completions: { classified: classified.rows[0]?.total ?? 0 },
    survey: {
      responses: scores.length,
      averageScore: scores.length === 0 ? null : scores.reduce((sum, score) => sum + score, 0) / scores.length,
      comments: comments === 0 ? { kind: 'none' } : { kind: 'some', count: comments },
    },
    sla: { queueWait: queueSla, firstResponse: responseSla },
    presenceSeconds: presenceSeconds(presence.rows, query.from, query.to),
  });
}

function scopeFilter(scope: QualityScope, index: number): { sql: string; params: string[] } {
  switch (scope.kind) {
    case 'tenant':
      return { sql: '', params: [] };
    case 'queue':
      return { sql: `AND conversation.queue_id = $${index}`, params: [scope.queueId] };
    case 'sector':
      return {
        sql: `AND conversation.queue_id IN (
          SELECT sector_queue.queue_id FROM sector_queues AS sector_queue
          WHERE sector_queue.tenant_id = conversation.tenant_id AND sector_queue.sector_id = $${index}
        )`,
        params: [scope.sectorId],
      };
    default: {
      const unexpected: never = scope;
      throw new DomainError('invalid_payload', `Escopo inesperado: ${String(unexpected)}`);
    }
  }
}

function presenceScope(scope: QualityScope): { sql: string; params: string[] } {
  switch (scope.kind) {
    case 'tenant':
      return { sql: '', params: [] };
    case 'queue':
      return {
        sql: `AND EXISTS (
          SELECT 1 FROM sector_queues AS sector_queue
          JOIN sector_members AS member ON member.sector_id = sector_queue.sector_id AND member.tenant_id = sector_queue.tenant_id
          WHERE sector_queue.tenant_id = agent.tenant_id AND sector_queue.queue_id = $2
            AND member.agent_id = agent.id AND member.removed_at IS NULL
        )`,
        params: [scope.queueId],
      };
    case 'sector':
      return {
        sql: `AND EXISTS (
          SELECT 1 FROM sector_members AS member
          WHERE member.tenant_id = agent.tenant_id AND member.sector_id = $2
            AND member.agent_id = agent.id AND member.removed_at IS NULL
        )`,
        params: [scope.sectorId],
      };
    default: {
      const unexpected: never = scope;
      throw new DomainError('invalid_payload', `Escopo inesperado: ${String(unexpected)}`);
    }
  }
}

function threshold(
  versions: readonly SlaPolicyVersion[],
  fact: QueueWaitFact | FirstResponseFact,
  clock: 'queue_wait' | 'first_response',
): { thresholdSeconds: number } | null {
  if (!('queueId' in fact) || !fact.queueId) return null;
  const instant = 'startedAt' in fact ? fact.startedAt : 'at' in fact ? fact.at : null;
  if (!instant) return null;
  const policy = policyAt(versions, fact.queueId, instant);
  if (!policy) return null;
  return { thresholdSeconds: clock === 'queue_wait' ? policy.queueWaitThresholdSeconds : policy.firstResponseThresholdSeconds };
}

function tally(judgements: SlaJudgement[]): { within: number; breached: number; notApplicable: number } {
  return {
    within: judgements.filter((item) => item.outcome === 'within').length,
    breached: judgements.filter((item) => item.outcome === 'breached').length,
    notApplicable: judgements.filter((item) => item.outcome === 'not_applicable').length,
  };
}

function durationSummary(samples: number[]): QualityReport['queueWait'] {
  if (samples.length === 0) {
    return { samples: 0, totalSeconds: null, averageSeconds: null, p50Seconds: null, p90Seconds: null, maxSeconds: null };
  }
  const sorted = [...samples].sort((left, right) => left - right);
  const total = sorted.reduce((sum, value) => sum + value, 0);
  const pick = (ratio: number) => sorted[Math.ceil(ratio * sorted.length) - 1] ?? 0;
  return {
    samples: sorted.length,
    totalSeconds: total,
    averageSeconds: total / sorted.length,
    p50Seconds: pick(0.5),
    p90Seconds: pick(0.9),
    maxSeconds: sorted[sorted.length - 1] ?? 0,
  };
}

function presenceSeconds(
  rows: { status: string; started_at: Date; ended_at: Date | null }[],
  from: string,
  to: string,
): QualityReport['presenceSeconds'] {
  const start = Date.parse(from);
  const end = Date.parse(to);
  const totals = { available: 0, busy: 0, away: 0, offline: 0 };
  for (const row of rows) {
    const opened = row.started_at.getTime();
    const closed = row.ended_at ? row.ended_at.getTime() : end;
    const overlap = Math.max(0, Math.min(closed, end) - Math.max(opened, start));
    if (row.status === 'available' || row.status === 'busy' || row.status === 'away' || row.status === 'offline') {
      totals[row.status] += Math.floor(overlap / 1000);
    }
  }
  return totals;
}

function isTimelineType(type: string): type is ConversationTimelineEvent['type'] {
  switch (type) {
    case 'queued':
    case 'assigned':
    case 'released':
    case 'transferred':
    case 'left':
    case 'classified':
    case 'survey_submitted':
    case 'closed':
      return true;
    default:
      return false;
  }
}
