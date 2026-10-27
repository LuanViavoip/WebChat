import {
  sectorSummarySchema,
  type SectorPerson,
  type SectorSummary,
} from '@viavoip/protocol';
import type { Pool, PoolClient } from 'pg';
import { isUniqueViolation } from '../db/pg-error.js';
import { withTenant, withTenantAdvisoryLock } from '../db/tenant.js';
import { internalSectorLockKey } from '../db/locks.js';
import { isStaff } from '../domain/access.js';
import { DomainError } from '../domain/errors.js';
import type { AgentPrincipal } from '../domain/types.js';
import { writeAudit } from './audit.js';

export type SectorMutation = {
  sector: SectorSummary;
  conversationId: string;
  notifyAgentIds: string[];
};

type SectorRow = {
  id: string;
  name: string;
  description: string;
  active: boolean;
  created_at: Date;
  can_manage: boolean;
};

type PersonRow = {
  sector_id: string;
  agent_id: string;
  name: string;
  role: SectorPerson['role'];
  link: 'member' | 'supervisor';
};

export class SectorService {
  constructor(private readonly pool: Pool) {}

  async list(principal: AgentPrincipal): Promise<SectorSummary[]> {
    return withTenant(this.pool, principal.tenantId, async (client) => {
      const rows = await visibleSectors(client, principal);
      return hydrate(client, principal.tenantId, rows);
    });
  }

  async save(
    principal: AgentPrincipal,
    input: {
      sectorId?: string;
      name: string;
      description?: string;
      active?: boolean;
      supervisorIds?: string[];
    },
  ): Promise<SectorMutation> {
    if (!isStaff(principal.kind)) throw new DomainError('forbidden', 'Setor restrito à supervisão');
    const mutate = async (client: PoolClient): Promise<SectorMutation> => {
      const sectorId = input.sectorId
        ? await updateSector(client, principal, input.sectorId, input)
        : await insertSector(client, principal, input);
      const supervisorIds = input.supervisorIds ?? (input.sectorId ? null : [principal.agentId]);
      if (supervisorIds) await replaceSupervisors(client, principal.tenantId, sectorId, supervisorIds);
      await syncGroupParticipants(client, principal.tenantId, sectorId);
      await writeAudit(client, principal.tenantId, principal.agentId, 'sector.save', 'sector', sectorId);
      return mutation(client, principal, sectorId);
    };
    return input.sectorId
      ? withTenantAdvisoryLock(this.pool, principal.tenantId, internalSectorLockKey(principal.tenantId, input.sectorId), mutate)
      : withTenant(this.pool, principal.tenantId, mutate);
  }

  async addMember(principal: AgentPrincipal, sectorId: string, agentId: string): Promise<SectorMutation> {
    return withTenantAdvisoryLock(this.pool, principal.tenantId, internalSectorLockKey(principal.tenantId, sectorId), async (client) => {
      await assertManages(client, principal, sectorId, true);
      const person = await client.query(`SELECT id FROM agents WHERE id = $1 AND tenant_id = $2`, [
        agentId,
        principal.tenantId,
      ]);
      if (!person.rows[0]) throw new DomainError('not_found', 'Pessoa não encontrada');
      await client.query(
        `INSERT INTO sector_members (sector_id, agent_id, tenant_id)
         VALUES ($1, $2, $3)
         ON CONFLICT (sector_id, agent_id) DO UPDATE SET removed_at = NULL`,
        [sectorId, agentId, principal.tenantId],
      );
      await syncGroupParticipants(client, principal.tenantId, sectorId);
      await writeAudit(client, principal.tenantId, principal.agentId, 'sector.member_added', 'sector', sectorId);
      return mutation(client, principal, sectorId);
    });
  }

  async removeMember(principal: AgentPrincipal, sectorId: string, agentId: string): Promise<SectorMutation> {
    return withTenantAdvisoryLock(this.pool, principal.tenantId, internalSectorLockKey(principal.tenantId, sectorId), async (client) => {
      await assertManages(client, principal, sectorId, false);
      await client.query(
        `UPDATE sector_members
         SET removed_at = now()
         WHERE sector_id = $1 AND agent_id = $2 AND tenant_id = $3 AND removed_at IS NULL`,
        [sectorId, agentId, principal.tenantId],
      );
      await syncGroupParticipants(client, principal.tenantId, sectorId);
      await writeAudit(client, principal.tenantId, principal.agentId, 'sector.member_removed', 'sector', sectorId);
      return mutation(client, principal, sectorId);
    });
  }
}

async function insertSector(
  client: PoolClient,
  principal: AgentPrincipal,
  input: { name: string; description?: string; active?: boolean },
): Promise<string> {
  try {
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO sectors (tenant_id, name, description, active)
       VALUES ($1, $2, $3, $4)
       RETURNING id`,
      [principal.tenantId, input.name, input.description ?? '', input.active ?? true],
    );
    const sectorId = inserted.rows[0]?.id;
    if (!sectorId) throw new DomainError('internal', 'Falha ao criar setor');
    await client.query(
      `INSERT INTO internal_conversations (tenant_id, kind, sector_id)
       VALUES ($1, 'group', $2)
       ON CONFLICT (tenant_id, sector_id) WHERE kind = 'group' DO NOTHING`,
      [principal.tenantId, sectorId],
    );
    return sectorId;
  } catch (error) {
    if (isUniqueViolation(error)) throw new DomainError('conflict', 'Já existe um setor com esse nome');
    throw error;
  }
}

async function updateSector(
  client: PoolClient,
  principal: AgentPrincipal,
  sectorId: string,
  input: { name: string; description?: string; active?: boolean },
): Promise<string> {
  await assertManages(client, principal, sectorId, false);
  try {
    const updated = await client.query(
      `UPDATE sectors
       SET name = $3,
           description = CASE WHEN $4::text IS NULL THEN description ELSE $4 END,
           active = CASE WHEN $5::boolean IS NULL THEN active ELSE $5 END
       WHERE id = $1 AND tenant_id = $2`,
      [sectorId, principal.tenantId, input.name, input.description ?? null, input.active ?? null],
    );
    if (updated.rowCount === 0) throw new DomainError('not_found', 'Setor não encontrado');
    return sectorId;
  } catch (error) {
    if (isUniqueViolation(error)) throw new DomainError('conflict', 'Já existe um setor com esse nome');
    throw error;
  }
}

async function replaceSupervisors(
  client: PoolClient,
  tenantId: string,
  sectorId: string,
  supervisorIds: string[],
): Promise<void> {
  if (supervisorIds.length > 0) {
    const found = await client.query<{ id: string; role: string }>(
      `SELECT id, role FROM agents WHERE tenant_id = $1 AND id = ANY($2::uuid[])`,
      [tenantId, supervisorIds],
    );
    if (found.rows.length !== new Set(supervisorIds).size) {
      throw new DomainError('not_found', 'Supervisor não encontrado');
    }
    if (found.rows.some((row) => row.role === 'agent')) {
      throw new DomainError('invalid_payload', 'Responsável precisa ser supervisor ou administrador');
    }
  }
  await client.query(
    `UPDATE sector_supervisors
     SET removed_at = now()
     WHERE sector_id = $1 AND tenant_id = $2 AND removed_at IS NULL
       AND NOT (agent_id = ANY($3::uuid[]))`,
    [sectorId, tenantId, supervisorIds],
  );
  for (const agentId of supervisorIds) {
    await client.query(
      `INSERT INTO sector_supervisors (sector_id, agent_id, tenant_id)
       VALUES ($1, $2, $3)
       ON CONFLICT (sector_id, agent_id) DO UPDATE SET removed_at = NULL`,
      [sectorId, agentId, tenantId],
    );
  }
}

export async function syncGroupParticipants(client: PoolClient, tenantId: string, sectorId: string): Promise<void> {
  const conversation = await client.query<{ id: string }>(
    `SELECT id FROM internal_conversations
     WHERE tenant_id = $1 AND sector_id = $2 AND kind = 'group'`,
    [tenantId, sectorId],
  );
  const conversationId = conversation.rows[0]?.id;
  if (!conversationId) throw new DomainError('internal', 'Grupo do setor ausente');
  const people = await client.query<{ agent_id: string }>(
    `SELECT agent_id FROM sector_members
     WHERE sector_id = $1 AND tenant_id = $2 AND removed_at IS NULL
     UNION
     SELECT agent_id FROM sector_supervisors
     WHERE sector_id = $1 AND tenant_id = $2 AND removed_at IS NULL`,
    [sectorId, tenantId],
  );
  const ids = people.rows.map((row) => row.agent_id);
  await client.query(
    `UPDATE internal_participants
     SET removed_at = now()
     WHERE conversation_id = $1 AND tenant_id = $2 AND removed_at IS NULL
       AND NOT (agent_id = ANY($3::uuid[]))`,
    [conversationId, tenantId, ids],
  );
  for (const agentId of ids) {
    await client.query(
      `INSERT INTO internal_participants (conversation_id, agent_id, tenant_id)
       VALUES ($1, $2, $3)
       ON CONFLICT (conversation_id, agent_id) DO UPDATE SET removed_at = NULL`,
      [conversationId, agentId, tenantId],
    );
  }
}

async function assertManages(
  client: PoolClient,
  principal: AgentPrincipal,
  sectorId: string,
  requireActive: boolean,
): Promise<void> {
  if (!isStaff(principal.kind)) throw new DomainError('forbidden', 'Setor restrito à supervisão');
  const sector = await client.query<{ active: boolean }>(
    `SELECT active FROM sectors WHERE id = $1 AND tenant_id = $2`,
    [sectorId, principal.tenantId],
  );
  const row = sector.rows[0];
  if (!row) throw new DomainError(principal.kind === 'admin' ? 'not_found' : 'forbidden', 'Setor não encontrado');
  if (requireActive && !row.active) throw new DomainError('invalid_state', 'Setor inativo');
  if (principal.kind === 'admin') return;
  const lead = await client.query(
    `SELECT 1 FROM sector_supervisors
     WHERE sector_id = $1 AND agent_id = $2 AND tenant_id = $3 AND removed_at IS NULL`,
    [sectorId, principal.agentId, principal.tenantId],
  );
  if (!lead.rows[0]) throw new DomainError('forbidden', 'Setor fora do seu escopo');
}

async function mutation(client: PoolClient, principal: AgentPrincipal, sectorId: string): Promise<SectorMutation> {
  const rows = await visibleSectors(client, principal, sectorId);
  const sector = (await hydrate(client, principal.tenantId, rows))[0];
  if (!sector) throw new DomainError('internal', 'Setor não pôde ser lido');
  const conversation = await client.query<{ id: string }>(
    `SELECT id FROM internal_conversations
     WHERE tenant_id = $1 AND sector_id = $2 AND kind = 'group'`,
    [principal.tenantId, sectorId],
  );
  const conversationId = conversation.rows[0]?.id;
  if (!conversationId) throw new DomainError('internal', 'Grupo do setor ausente');
  const notify = await client.query<{ agent_id: string }>(
    `SELECT agent_id FROM sector_members
     WHERE sector_id = $1 AND tenant_id = $2 AND removed_at IS NULL
     UNION
     SELECT agent_id FROM sector_supervisors
     WHERE sector_id = $1 AND tenant_id = $2 AND removed_at IS NULL
     UNION
     SELECT id AS agent_id FROM agents
     WHERE tenant_id = $2 AND role = 'admin'`,
    [sectorId, principal.tenantId],
  );
  return {
    sector,
    conversationId,
    notifyAgentIds: notify.rows.map((row) => row.agent_id),
  };
}

async function visibleSectors(client: PoolClient, principal: AgentPrincipal, sectorId?: string): Promise<SectorRow[]> {
  const result = await client.query<SectorRow>(
    `SELECT sector.id, sector.name, sector.description, sector.active, sector.created_at,
            (
              $3::boolean
              OR EXISTS (
                SELECT 1 FROM sector_supervisors AS lead
                WHERE lead.sector_id = sector.id
                  AND lead.agent_id = $2
                  AND lead.tenant_id = sector.tenant_id
                  AND lead.removed_at IS NULL
              )
            ) AS can_manage
     FROM sectors AS sector
     WHERE sector.tenant_id = $1
       AND ($4::uuid IS NULL OR sector.id = $4)
       AND (
         $3::boolean
         OR EXISTS (
           SELECT 1 FROM sector_supervisors AS lead
           WHERE lead.sector_id = sector.id
             AND lead.agent_id = $2
             AND lead.tenant_id = sector.tenant_id
             AND lead.removed_at IS NULL
         )
         OR EXISTS (
           SELECT 1 FROM sector_members AS member
           WHERE member.sector_id = sector.id
             AND member.agent_id = $2
             AND member.tenant_id = sector.tenant_id
             AND member.removed_at IS NULL
         )
       )
     ORDER BY sector.name`,
    [principal.tenantId, principal.agentId, principal.kind === 'admin', sectorId ?? null],
  );
  return result.rows;
}

async function hydrate(client: PoolClient, tenantId: string, rows: SectorRow[]): Promise<SectorSummary[]> {
  if (rows.length === 0) return [];
  const people = await client.query<PersonRow>(
    `SELECT member.sector_id, agent.id AS agent_id, agent.name, agent.role, 'member' AS link
     FROM sector_members AS member
     JOIN agents AS agent ON agent.id = member.agent_id AND agent.tenant_id = member.tenant_id
     WHERE member.tenant_id = $1 AND member.removed_at IS NULL AND member.sector_id = ANY($2::uuid[])
     UNION ALL
     SELECT lead.sector_id, agent.id, agent.name, agent.role, 'supervisor' AS link
     FROM sector_supervisors AS lead
     JOIN agents AS agent ON agent.id = lead.agent_id AND agent.tenant_id = lead.tenant_id
     WHERE lead.tenant_id = $1 AND lead.removed_at IS NULL AND lead.sector_id = ANY($2::uuid[])
     ORDER BY name`,
    [tenantId, rows.map((row) => row.id)],
  );
  return rows.map((row) => {
    const related = people.rows.filter((person) => person.sector_id === row.id);
    return sectorSummarySchema.parse({
      id: row.id,
      name: row.name,
      description: row.description,
      active: row.active,
      createdAt: row.created_at.toISOString(),
      canManage: row.can_manage,
      members: related
        .filter((person) => person.link === 'member')
        .map((person) => ({ agentId: person.agent_id, name: person.name, role: person.role })),
      supervisors: related
        .filter((person) => person.link === 'supervisor')
        .map((person) => ({ agentId: person.agent_id, name: person.name, role: person.role })),
    });
  });
}
