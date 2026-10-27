import type { PoolClient } from 'pg';

export async function writeAudit(
  client: PoolClient,
  tenantId: string,
  actorId: string,
  action: string,
  resourceType: string,
  resourceId: string | null,
): Promise<void> {
  await client.query(
    `INSERT INTO audit_events (tenant_id, actor_id, action, resource_type, resource_id)
     VALUES ($1, $2, $3, $4, $5)`,
    [tenantId, actorId, action, resourceType, resourceId],
  );
}
