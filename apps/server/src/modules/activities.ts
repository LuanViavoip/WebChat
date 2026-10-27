import {
  activityAssignmentSchema,
  activityTypeSchema,
  type ActivityAssignment,
  type ActivityType,
} from '@viavoip/protocol';
import type { Pool, PoolClient } from 'pg';
import { isUniqueViolation } from '../db/pg-error.js';
import { withTenant } from '../db/tenant.js';
import { isStaff } from '../domain/access.js';
import { DomainError } from '../domain/errors.js';
import type { AgentPrincipal } from '../domain/types.js';
import { writeAudit } from './audit.js';

type AssignmentRow = {
  id: string;
  agent_id: string;
  agent_name: string;
  activity_type_id: string;
  activity_name: string;
  assigned_by: string;
  started_at: Date;
  ended_at: Date | null;
  status: 'active' | 'finished';
};

export type ActivityMutation = {
  assignment: ActivityAssignment;
  notifyAgentIds: string[];
};

export class ActivityService {
  constructor(private readonly pool: Pool) {}

  async catalog(principal: AgentPrincipal): Promise<{ types: ActivityType[]; current: ActivityAssignment | null }> {
    return withTenant(this.pool, principal.tenantId, async (client) => {
      const types = await client.query<{ id: string; name: string; active: boolean }>(
        `SELECT id, name, active
         FROM activity_types
         WHERE tenant_id = $1 AND active = true
         ORDER BY name`,
        [principal.tenantId],
      );
      const current = await client.query<AssignmentRow>(
        `${assignmentSelect}
         WHERE assignment.tenant_id = $1 AND assignment.agent_id = $2 AND assignment.ended_at IS NULL`,
        [principal.tenantId, principal.agentId],
      );
      return {
        types: types.rows.map((row) => activityTypeSchema.parse(row)),
        current: current.rows[0] ? mapAssignment(current.rows[0]) : null,
      };
    });
  }

  async saveType(
    principal: AgentPrincipal,
    input: { activityTypeId?: string; name: string; active?: boolean },
  ): Promise<ActivityType> {
    if (principal.kind !== 'admin') throw new DomainError('forbidden', 'Tipo de atividade exclusivo do administrador');
    return withTenant(this.pool, principal.tenantId, async (client) => {
      try {
        const saved = input.activityTypeId
          ? await client.query<{ id: string; name: string; active: boolean }>(
              `UPDATE activity_types
               SET name = $3, active = COALESCE($4, active)
               WHERE id = $1 AND tenant_id = $2
               RETURNING id, name, active`,
              [input.activityTypeId, principal.tenantId, input.name, input.active ?? null],
            )
          : await client.query<{ id: string; name: string; active: boolean }>(
              `INSERT INTO activity_types (tenant_id, name, active)
               VALUES ($1, $2, $3)
               RETURNING id, name, active`,
              [principal.tenantId, input.name, input.active ?? true],
            );
        const row = saved.rows[0];
        if (!row) throw new DomainError('not_found', 'Tipo de atividade não encontrado');
        await writeAudit(client, principal.tenantId, principal.agentId, 'activity.type_save', 'activity_type', row.id);
        return activityTypeSchema.parse(row);
      } catch (error) {
        if (isUniqueViolation(error)) throw new DomainError('conflict', 'Já existe uma atividade com esse nome');
        throw error;
      }
    });
  }

  async assign(principal: AgentPrincipal, agentId: string, activityTypeId: string): Promise<ActivityMutation> {
    return withTenant(this.pool, principal.tenantId, async (client) => {
      await assertCanAllocate(client, principal, agentId);
      await lockAgent(client, principal.tenantId, agentId);
      const activity = await client.query(
        `SELECT id FROM activity_types WHERE id = $1 AND tenant_id = $2 AND active = true`,
        [activityTypeId, principal.tenantId],
      );
      if (!activity.rows[0]) throw new DomainError('not_found', 'Atividade não encontrada');
      await client.query(
        `UPDATE activity_assignments
         SET ended_at = now(), status = 'finished'
         WHERE agent_id = $1 AND tenant_id = $2 AND ended_at IS NULL`,
        [agentId, principal.tenantId],
      );
      const inserted = await client.query<{ id: string }>(
        `INSERT INTO activity_assignments (
           tenant_id, agent_id, activity_type_id, assigned_by, status
         ) VALUES ($1, $2, $3, $4, 'active')
         RETURNING id`,
        [principal.tenantId, agentId, activityTypeId, principal.agentId],
      );
      const assignmentId = inserted.rows[0]?.id;
      if (!assignmentId) throw new DomainError('internal', 'Falha ao alocar atividade');
      await writeAudit(client, principal.tenantId, principal.agentId, 'activity.assign', 'activity_assignment', assignmentId);
      const assignment = await oneAssignment(client, principal.tenantId, assignmentId);
      return { assignment, notifyAgentIds: await watchers(client, principal.tenantId, agentId) };
    });
  }

  async finish(principal: AgentPrincipal, agentId: string): Promise<ActivityMutation> {
    return withTenant(this.pool, principal.tenantId, async (client) => {
      await assertCanAllocate(client, principal, agentId);
      await lockAgent(client, principal.tenantId, agentId);
      const finished = await client.query<{ id: string }>(
        `UPDATE activity_assignments
         SET ended_at = now(), status = 'finished'
         WHERE agent_id = $1 AND tenant_id = $2 AND ended_at IS NULL
         RETURNING id`,
        [agentId, principal.tenantId],
      );
      const assignmentId = finished.rows[0]?.id;
      if (!assignmentId) throw new DomainError('invalid_state', 'Não há atividade em andamento');
      await writeAudit(client, principal.tenantId, principal.agentId, 'activity.finish', 'activity_assignment', assignmentId);
      const assignment = await oneAssignment(client, principal.tenantId, assignmentId);
      return { assignment, notifyAgentIds: await watchers(client, principal.tenantId, agentId) };
    });
  }

  async history(principal: AgentPrincipal, agentId?: string): Promise<ActivityAssignment[]> {
    const targetId = agentId ?? principal.agentId;
    return withTenant(this.pool, principal.tenantId, async (client) => {
      await assertCanReadAgent(client, principal, targetId);
      const result = await client.query<AssignmentRow>(
        `${assignmentSelect}
         WHERE assignment.tenant_id = $1 AND assignment.agent_id = $2
         ORDER BY assignment.started_at DESC`,
        [principal.tenantId, targetId],
      );
      return result.rows.map(mapAssignment);
    });
  }
}

const assignmentSelect = `
  SELECT assignment.id, assignment.agent_id, agent.name AS agent_name,
         assignment.activity_type_id, activity.name AS activity_name,
         assignment.assigned_by, assignment.started_at, assignment.ended_at, assignment.status
  FROM activity_assignments AS assignment
  JOIN agents AS agent ON agent.id = assignment.agent_id AND agent.tenant_id = assignment.tenant_id
  JOIN activity_types AS activity
    ON activity.id = assignment.activity_type_id
   AND activity.tenant_id = assignment.tenant_id
`;

async function assertCanAllocate(client: PoolClient, principal: AgentPrincipal, agentId: string): Promise<void> {
  const target = await client.query<{ can_change_own_activity: boolean }>(
    `SELECT can_change_own_activity FROM agents WHERE id = $1 AND tenant_id = $2`,
    [agentId, principal.tenantId],
  );
  if (!target.rows[0]) throw new DomainError('not_found', 'Pessoa não encontrada');
  if (principal.kind === 'admin') return;
  if (principal.agentId === agentId) {
    if (principal.kind === 'agent' && !target.rows[0].can_change_own_activity) {
      throw new DomainError('forbidden', 'Sem permissão para alterar a própria atividade');
    }
    if (isStaff(principal.kind)) return;
    if (target.rows[0].can_change_own_activity) return;
  }
  if (principal.kind !== 'supervisor') throw new DomainError('forbidden', 'Alocação fora do seu escopo');
  const shared = await client.query(
    `SELECT 1
     FROM sector_members AS member
     JOIN sector_supervisors AS lead
       ON lead.sector_id = member.sector_id
      AND lead.tenant_id = member.tenant_id
     JOIN sectors AS sector ON sector.id = member.sector_id AND sector.tenant_id = member.tenant_id
     WHERE member.agent_id = $1
       AND member.tenant_id = $3
       AND member.removed_at IS NULL
       AND lead.agent_id = $2
       AND lead.removed_at IS NULL
       AND sector.active = true`,
    [agentId, principal.agentId, principal.tenantId],
  );
  if (!shared.rows[0]) throw new DomainError('forbidden', 'Agente fora do seu setor');
}

async function assertCanReadAgent(client: PoolClient, principal: AgentPrincipal, agentId: string): Promise<void> {
  if (principal.agentId === agentId || principal.kind === 'admin') {
    const found = await client.query(`SELECT 1 FROM agents WHERE id = $1 AND tenant_id = $2`, [
      agentId,
      principal.tenantId,
    ]);
    if (!found.rows[0]) throw new DomainError('not_found', 'Pessoa não encontrada');
    return;
  }
  await assertCanAllocate(client, principal, agentId);
}

async function lockAgent(client: PoolClient, tenantId: string, agentId: string): Promise<void> {
  await client.query(
    `INSERT INTO agent_presence (agent_id, tenant_id, desired_status)
     VALUES ($1, $2, 'available')
     ON CONFLICT (agent_id) DO UPDATE SET desired_status = agent_presence.desired_status`,
    [agentId, tenantId],
  );
  await client.query(`SELECT agent_id FROM agent_presence WHERE agent_id = $1 AND tenant_id = $2 FOR UPDATE`, [
    agentId,
    tenantId,
  ]);
}

async function oneAssignment(client: PoolClient, tenantId: string, assignmentId: string): Promise<ActivityAssignment> {
  const result = await client.query<AssignmentRow>(
    `${assignmentSelect} WHERE assignment.tenant_id = $1 AND assignment.id = $2`,
    [tenantId, assignmentId],
  );
  const row = result.rows[0];
  if (!row) throw new DomainError('internal', 'Alocação não pôde ser lida');
  return mapAssignment(row);
}

async function watchers(client: PoolClient, tenantId: string, agentId: string): Promise<string[]> {
  const result = await client.query<{ id: string }>(
    `SELECT $2::uuid AS id
     UNION
     SELECT id FROM agents WHERE tenant_id = $1 AND role = 'admin'
     UNION
     SELECT lead.agent_id
     FROM sector_supervisors AS lead
     JOIN sector_members AS member
       ON member.sector_id = lead.sector_id
      AND member.tenant_id = lead.tenant_id
     WHERE member.agent_id = $2
       AND member.tenant_id = $1
       AND member.removed_at IS NULL
       AND lead.removed_at IS NULL`,
    [tenantId, agentId],
  );
  return result.rows.map((row) => row.id);
}

function mapAssignment(row: AssignmentRow): ActivityAssignment {
  return activityAssignmentSchema.parse({
    id: row.id,
    agentId: row.agent_id,
    agentName: row.agent_name,
    activityTypeId: row.activity_type_id,
    activityName: row.activity_name,
    assignedBy: row.assigned_by,
    startedAt: row.started_at.toISOString(),
    endedAt: row.ended_at ? row.ended_at.toISOString() : null,
    status: row.status,
  });
}
