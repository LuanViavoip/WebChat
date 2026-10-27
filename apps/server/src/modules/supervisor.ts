import {
  desiredPresenceSchema,
  supervisorSnapshotSchema,
  type SupervisorSnapshot,
} from '@viavoip/protocol';
import type { Pool } from 'pg';
import { withTenant } from '../db/tenant.js';
import { isStaff } from '../domain/access.js';
import { DomainError } from '../domain/errors.js';
import type { AgentPrincipal } from '../domain/types.js';
import { resolvePresenceStatus } from './presence.js';

type AgentRow = {
  id: string;
  name: string;
  desired: string;
  updated_at: Date;
  live: number;
  active_conversations: number;
  max_concurrent: number;
  activity_name: string | null;
  activity_started_at: Date | null;
  sectors: string[] | null;
};

export class SupervisorService {
  constructor(
    private readonly pool: Pool,
    private readonly staleMs: number,
  ) {}

  async snapshot(
    principal: AgentPrincipal,
    range: { from?: string; to?: string },
  ): Promise<SupervisorSnapshot> {
    if (!isStaff(principal.kind)) throw new DomainError('forbidden', 'Painel exclusivo da supervisão');
    const to = range.to ? new Date(range.to) : new Date();
    const from = range.from
      ? new Date(range.from)
      : new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate()));
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from > to) {
      throw new DomainError('invalid_payload', 'Período inválido');
    }
    return withTenant(this.pool, principal.tenantId, async (client) => {
      const agents = await client.query<AgentRow>(
        `WITH scoped AS (
           SELECT agent.id, agent.name, agent.created_at
           FROM agents AS agent
           WHERE agent.tenant_id = $1
             AND agent.role = 'agent'
             AND (
               $2::boolean
               OR EXISTS (
                 SELECT 1
                 FROM sector_members AS member
                 JOIN sector_supervisors AS lead
                   ON lead.sector_id = member.sector_id
                  AND lead.tenant_id = member.tenant_id
                 JOIN sectors AS sector
                   ON sector.id = member.sector_id
                  AND sector.tenant_id = member.tenant_id
                 WHERE member.agent_id = agent.id
                   AND member.tenant_id = agent.tenant_id
                   AND member.removed_at IS NULL
                   AND lead.agent_id = $3
                   AND lead.removed_at IS NULL
                   AND sector.active = true
               )
             )
         )
         SELECT scoped.id,
                scoped.name,
                COALESCE(presence.desired_status, 'available') AS desired,
                COALESCE(presence.updated_at, scoped.created_at) AS updated_at,
                (
                  SELECT count(*)::int
                  FROM agent_connections AS connection
                  WHERE connection.agent_id = scoped.id
                    AND connection.tenant_id = $1
                    AND connection.last_heartbeat_at >= now() - ($4::int * interval '1 millisecond')
                ) AS live,
                (
                  SELECT count(*)::int
                  FROM conversations
                  WHERE agent_id = scoped.id AND tenant_id = $1 AND status = 'assigned'
                    AND (
                      $2::boolean
                      OR queue_id IN (
                        SELECT sector_queue.queue_id
                        FROM sector_supervisors AS lead
                        JOIN sectors AS sector ON sector.id = lead.sector_id AND sector.tenant_id = lead.tenant_id
                        JOIN sector_queues AS sector_queue ON sector_queue.sector_id = sector.id AND sector_queue.tenant_id = sector.tenant_id
                        WHERE lead.tenant_id = $1 AND lead.agent_id = $3
                          AND lead.removed_at IS NULL AND sector.active = true
                      )
                    )
                ) AS active_conversations,
                (SELECT max_concurrent_assignments FROM tenants WHERE id = $1) AS max_concurrent,
                activity.name AS activity_name,
                assignment.started_at AS activity_started_at,
                COALESCE(sector_names.names, ARRAY[]::text[]) AS sectors
         FROM scoped
         LEFT JOIN agent_presence AS presence
           ON presence.agent_id = scoped.id AND presence.tenant_id = $1
         LEFT JOIN activity_assignments AS assignment
           ON assignment.agent_id = scoped.id
          AND assignment.tenant_id = $1
          AND assignment.ended_at IS NULL
         LEFT JOIN activity_types AS activity
           ON activity.id = assignment.activity_type_id
          AND activity.tenant_id = assignment.tenant_id
         LEFT JOIN LATERAL (
           SELECT array_agg(sector.name ORDER BY sector.name) AS names
           FROM sector_members AS member
           JOIN sectors AS sector
             ON sector.id = member.sector_id
            AND sector.tenant_id = member.tenant_id
           WHERE member.agent_id = scoped.id
             AND member.tenant_id = $1
             AND member.removed_at IS NULL
             AND (
               $2::boolean
               OR EXISTS (
                 SELECT 1 FROM sector_supervisors AS lead
                 WHERE lead.sector_id = sector.id
                   AND lead.tenant_id = sector.tenant_id
                   AND lead.agent_id = $3
                   AND lead.removed_at IS NULL
                   AND sector.active = true
               )
             )
         ) AS sector_names ON true
         ORDER BY scoped.name`,
        [principal.tenantId, principal.kind === 'admin', principal.agentId, this.staleMs],
      );
      const traffic = await client.query<{
        waiting: number;
        assigned: number;
        awaiting_survey: number;
        closed_in_period: number;
        longest_wait_seconds: number | null;
      }>(
        `SELECT count(*) FILTER (WHERE status = 'queued')::int AS waiting,
                count(*) FILTER (WHERE status = 'assigned')::int AS assigned,
                count(*) FILTER (WHERE status = 'awaiting_survey')::int AS awaiting_survey,
                count(*) FILTER (
                  WHERE status = 'closed' AND ended_at >= $2 AND ended_at <= $3
                )::int AS closed_in_period,
                floor(extract(epoch FROM max(now() - queued_at) FILTER (WHERE status = 'queued')))::int AS longest_wait_seconds
         FROM conversations
         WHERE tenant_id = $1
           AND (
             $4::boolean
             OR queue_id IN (
               SELECT sector_queue.queue_id
               FROM sector_supervisors AS lead
               JOIN sectors AS sector ON sector.id = lead.sector_id AND sector.tenant_id = lead.tenant_id
               JOIN sector_queues AS sector_queue ON sector_queue.sector_id = sector.id AND sector_queue.tenant_id = sector.tenant_id
               WHERE lead.tenant_id = $1 AND lead.agent_id = $5
                 AND lead.removed_at IS NULL AND sector.active = true
             )
           )`,
        [principal.tenantId, from.toISOString(), to.toISOString(), principal.kind === 'admin', principal.agentId],
      );
      const queue = traffic.rows[0];
      if (!queue) throw new DomainError('internal', 'Indicadores indisponíveis');
      const listed = agents.rows.map((row) => {
        const desired = desiredPresenceSchema.parse(row.desired);
        const presence = resolvePresenceStatus({
          desired,
          live: Number(row.live),
          active: Number(row.active_conversations),
          maxConcurrent: Number(row.max_concurrent),
        });
        return {
          agentId: row.id,
          name: row.name,
          sectors: row.sectors ?? [],
          presence,
          activityName: row.activity_name,
          activityStartedAt: row.activity_started_at ? row.activity_started_at.toISOString() : null,
          activeConversations: Number(row.active_conversations),
          updatedAt: row.updated_at.toISOString(),
          connected: Number(row.live) > 0,
        };
      });
      const count = (status: string) => listed.filter((agent) => agent.presence === status).length;
      return supervisorSnapshotSchema.parse({
        metrics: {
          connected: listed.filter((agent) => agent.connected).length,
          available: count('available'),
          busy: count('busy'),
          away: count('away'),
          offline: count('offline'),
          waiting: Number(queue.waiting),
          assigned: Number(queue.assigned),
          awaitingSurvey: Number(queue.awaiting_survey),
          activities: listed.filter((agent) => agent.activityName).length,
          longestWaitSeconds: queue.longest_wait_seconds === null ? null : Number(queue.longest_wait_seconds),
          closedInPeriod: Number(queue.closed_in_period),
          generatedAt: new Date().toISOString(),
        },
        agents: listed,
      });
    });
  }
}
