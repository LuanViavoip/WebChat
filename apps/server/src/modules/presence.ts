import { desiredPresenceSchema, type DesiredPresence, type PresenceStatus } from '@viavoip/protocol';
import type { Pool, PoolClient } from 'pg';
import { withTenant } from '../db/tenant.js';
import { DomainError } from '../domain/errors.js';
import type { AgentPrincipal } from '../domain/types.js';

export type EffectivePresence = {
  agentId: string;
  tenantId: string;
  status: PresenceStatus;
  desired: DesiredPresence;
  activeCount: number;
  maxConcurrent: number;
  queueIds: string[];
};

type PresenceSnapshot = {
  desired: DesiredPresence;
  live: number;
  active: number;
  maxConcurrent: number;
  queueIds: string[];
};

export class PresenceService {
  constructor(
    private readonly pool: Pool,
    private readonly staleMs: number,
  ) {}

  async connect(principal: AgentPrincipal, socketId: string): Promise<EffectivePresence> {
    return withTenant(this.pool, principal.tenantId, async (client) => {
      await ensurePresence(client, principal.tenantId, principal.agentId);
      await client.query(
        `INSERT INTO agent_connections (socket_id, agent_id, tenant_id, last_heartbeat_at)
         VALUES ($1, $2, $3, now())
         ON CONFLICT (socket_id) DO UPDATE
         SET agent_id = EXCLUDED.agent_id,
             tenant_id = EXCLUDED.tenant_id,
             last_heartbeat_at = now()`,
        [socketId, principal.agentId, principal.tenantId],
      );
      const presence = await this.readEffective(client, principal.tenantId, principal.agentId);
      await syncInterval(client, principal.tenantId, principal.agentId, presence.status);
      return presence;
    });
  }

  async disconnect(
    principal: AgentPrincipal,
    socketId: string,
  ): Promise<{ previous: PresenceStatus; next: EffectivePresence }> {
    return withTenant(this.pool, principal.tenantId, async (client) => {
      const previous = await this.readEffective(client, principal.tenantId, principal.agentId);
      await client.query(
        `DELETE FROM agent_connections
         WHERE socket_id = $1 AND agent_id = $2 AND tenant_id = $3`,
        [socketId, principal.agentId, principal.tenantId],
      );
      const next = await this.readEffective(client, principal.tenantId, principal.agentId);
      await syncInterval(client, principal.tenantId, principal.agentId, next.status);
      return { previous: previous.status, next };
    });
  }

  async heartbeat(
    principal: AgentPrincipal,
    socketId: string,
  ): Promise<{ previous: PresenceStatus; next: EffectivePresence }> {
    return withTenant(this.pool, principal.tenantId, async (client) => {
      const previous = await this.readEffective(client, principal.tenantId, principal.agentId);
      const updated = await client.query(
        `UPDATE agent_connections
         SET last_heartbeat_at = now()
         WHERE socket_id = $1 AND agent_id = $2 AND tenant_id = $3`,
        [socketId, principal.agentId, principal.tenantId],
      );
      if (updated.rowCount === 0) {
        await ensurePresence(client, principal.tenantId, principal.agentId);
        await client.query(
          `INSERT INTO agent_connections (socket_id, agent_id, tenant_id, last_heartbeat_at)
           VALUES ($1, $2, $3, now())`,
          [socketId, principal.agentId, principal.tenantId],
        );
      }
      const next = await this.readEffective(client, principal.tenantId, principal.agentId);
      await syncInterval(client, principal.tenantId, principal.agentId, next.status);
      return { previous: previous.status, next };
    });
  }

  async setDesired(principal: AgentPrincipal, status: DesiredPresence): Promise<EffectivePresence> {
    return withTenant(this.pool, principal.tenantId, async (client) => {
      await client.query(
        `INSERT INTO agent_presence (agent_id, tenant_id, desired_status)
         VALUES ($1, $2, $3)
         ON CONFLICT (agent_id) DO UPDATE
         SET desired_status = EXCLUDED.desired_status,
             updated_at = now()`,
        [principal.agentId, principal.tenantId, status],
      );
      const presence = await this.readEffective(client, principal.tenantId, principal.agentId);
      await syncInterval(client, principal.tenantId, principal.agentId, presence.status);
      return presence;
    });
  }

  async effectiveById(tenantId: string, agentId: string): Promise<EffectivePresence> {
    return withTenant(this.pool, tenantId, (client) => this.readEffective(client, tenantId, agentId));
  }

  async lockAndAssertCanClaim(client: PoolClient, principal: AgentPrincipal): Promise<void> {
    const snapshot = await lockSnapshot(client, principal.tenantId, principal.agentId, this.staleMs);
    const status = resolveStatus(snapshot);
    switch (status) {
      case 'available':
        return;
      case 'busy':
        if (snapshot.desired === 'available' && snapshot.active >= snapshot.maxConcurrent) {
          throw new DomainError('capacity', 'Limite de atendimentos simultâneos atingido');
        }
        throw new DomainError('invalid_state', 'Agente ocupado');
      case 'away':
        throw new DomainError('invalid_state', 'Agente ausente');
      case 'offline':
        throw new DomainError('invalid_state', 'Agente desconectado');
      default: {
        const neverStatus: never = status;
        throw new DomainError('internal', `Presença inesperada: ${String(neverStatus)}`);
      }
    }
  }

  async sweep(): Promise<EffectivePresence[]> {
    const deleted = await this.pool.query<{ agent_id: string; tenant_id: string }>(
      `SELECT agent_id, tenant_id FROM sweep_stale_agent_connections($1)`,
      [this.staleMs],
    );
    const affected = new Map<string, { agentId: string; tenantId: string }>();
    for (const row of deleted.rows) {
      affected.set(row.agent_id, { agentId: row.agent_id, tenantId: row.tenant_id });
    }
    const presence: EffectivePresence[] = [];
    for (const item of affected.values()) {
      const next = await this.effectiveById(item.tenantId, item.agentId);
      await this.note(item.tenantId, item.agentId, next.status);
      presence.push(next);
    }
    return presence;
  }

  async note(tenantId: string, agentId: string, status: PresenceStatus): Promise<void> {
    await withTenant(this.pool, tenantId, async (client) => {
      await ensurePresence(client, tenantId, agentId);
      await syncInterval(client, tenantId, agentId, status);
    });
  }

  private async readEffective(client: PoolClient, tenantId: string, agentId: string): Promise<EffectivePresence> {
    const desiredRow = await client.query<{ desired_status: string }>(
      `SELECT desired_status FROM agent_presence WHERE agent_id = $1 AND tenant_id = $2`,
      [agentId, tenantId],
    );
    const desired = desiredRow.rows[0]
      ? desiredPresenceSchema.parse(desiredRow.rows[0].desired_status)
      : 'available';
    const snapshot = await readSnapshot(client, tenantId, agentId, desired, this.staleMs);
    return toEffective(tenantId, agentId, snapshot);
  }
}

function toEffective(tenantId: string, agentId: string, snapshot: PresenceSnapshot): EffectivePresence {
  return {
    agentId,
    tenantId,
    status: resolveStatus(snapshot),
    desired: snapshot.desired,
    activeCount: snapshot.active,
    maxConcurrent: snapshot.maxConcurrent,
    queueIds: snapshot.queueIds,
  };
}

export function resolvePresenceStatus(input: {
  desired: DesiredPresence;
  live: number;
  active: number;
  maxConcurrent: number;
}): PresenceStatus {
  return resolveStatus({ ...input, queueIds: [] });
}

function resolveStatus(snapshot: PresenceSnapshot): PresenceStatus {
  if (snapshot.live < 1) return 'offline';
  switch (snapshot.desired) {
    case 'away':
      return 'away';
    case 'busy':
      return 'busy';
    case 'available':
      return snapshot.active >= snapshot.maxConcurrent ? 'busy' : 'available';
    default: {
      const neverDesired: never = snapshot.desired;
      throw new DomainError('internal', `Presença inesperada: ${String(neverDesired)}`);
    }
  }
}

async function syncInterval(
  client: PoolClient,
  tenantId: string,
  agentId: string,
  status: PresenceStatus,
): Promise<void> {
  await client.query(`SELECT agent_id FROM agent_presence WHERE agent_id = $1 AND tenant_id = $2 FOR UPDATE`, [
    agentId,
    tenantId,
  ]);
  const open = await client.query<{ id: string; status: string }>(
    `SELECT id, status
     FROM presence_intervals
     WHERE agent_id = $1 AND tenant_id = $2 AND ended_at IS NULL
     FOR UPDATE`,
    [agentId, tenantId],
  );
  const current = open.rows[0];
  if (current?.status === status) return;
  if (current) {
    await client.query(`UPDATE presence_intervals SET ended_at = now() WHERE id = $1 AND tenant_id = $2`, [
      current.id,
      tenantId,
    ]);
  }
  await client.query(
    `INSERT INTO presence_intervals (tenant_id, agent_id, status) VALUES ($1, $2, $3)`,
    [tenantId, agentId, status],
  );
}

async function ensurePresence(client: PoolClient, tenantId: string, agentId: string): Promise<void> {
  await client.query(
    `INSERT INTO agent_presence (agent_id, tenant_id, desired_status)
     VALUES ($1, $2, 'available')
     ON CONFLICT (agent_id) DO NOTHING`,
    [agentId, tenantId],
  );
}

async function lockSnapshot(
  client: PoolClient,
  tenantId: string,
  agentId: string,
  staleMs: number,
): Promise<PresenceSnapshot> {
  const locked = await client.query<{ desired_status: string }>(
    `INSERT INTO agent_presence (agent_id, tenant_id, desired_status)
     VALUES ($1, $2, 'available')
     ON CONFLICT (agent_id) DO UPDATE
     SET desired_status = agent_presence.desired_status
     RETURNING desired_status`,
    [agentId, tenantId],
  );
  const desired = desiredPresenceSchema.parse(locked.rows[0]?.desired_status);
  return readSnapshot(client, tenantId, agentId, desired, staleMs);
}

async function readSnapshot(
  client: PoolClient,
  tenantId: string,
  agentId: string,
  desired: DesiredPresence,
  staleMs: number,
): Promise<PresenceSnapshot> {
  const counts = await client.query<{ live: number; active: number; max_concurrent: number }>(
    `SELECT
       (
         SELECT count(*)::int
         FROM agent_connections
         WHERE agent_id = $1
           AND tenant_id = $2
           AND last_heartbeat_at >= now() - ($3::int * interval '1 millisecond')
       ) AS live,
       (
         SELECT count(*)::int
         FROM conversations
         WHERE agent_id = $1 AND tenant_id = $2 AND status = 'assigned'
       ) AS active,
       (
         SELECT max_concurrent_assignments
         FROM tenants
         WHERE id = $2
       ) AS max_concurrent`,
    [agentId, tenantId, staleMs],
  );
  const queues = await client.query<{ queue_id: string }>(
    `SELECT queue_id FROM agent_queues WHERE agent_id = $1 AND tenant_id = $2 ORDER BY queue_id`,
    [agentId, tenantId],
  );
  const row = counts.rows[0];
  if (!row || row.max_concurrent === null) throw new DomainError('internal', 'Limite do tenant ausente');
  return {
    desired,
    live: row.live,
    active: row.active,
    maxConcurrent: row.max_concurrent,
    queueIds: queues.rows.map((item) => item.queue_id),
  };
}
