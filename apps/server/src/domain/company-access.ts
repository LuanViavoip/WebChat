import type { CompanyCommand, QualityScope } from '@viavoip/protocol';
import type { PoolClient } from 'pg';
import { assertSupervisorQueueAccess } from './access.js';
import { DomainError } from './errors.js';
import type { AgentPrincipal, Principal } from './types.js';

export type CompanyAccess =
  | { capability: 'company.desk' }
  | { capability: 'company.command'; command: CompanyCommand['kind'] }
  | { capability: 'quality.report'; scope: QualityScope }
  | { capability: 'audit.read' };

export async function assertCompanyAccess(
  client: PoolClient,
  principal: Principal,
  access: CompanyAccess,
): Promise<void> {
  if (principal.kind === 'admin') return;
  if (principal.kind === 'supervisor') {
    await assertSupervisorCompanyAccess(client, principal, access);
    return;
  }
  throw new DomainError('forbidden', 'Gestão exclusiva do administrador');
}

async function assertSupervisorCompanyAccess(
  client: PoolClient,
  principal: AgentPrincipal,
  access: CompanyAccess,
): Promise<void> {
  if (access.capability === 'quality.report') {
    await assertSupervisorQualityScope(client, principal, access.scope);
    return;
  }
  throw new DomainError('forbidden', 'Gestão exclusiva do administrador');
}

async function assertSupervisorQualityScope(
  client: PoolClient,
  principal: AgentPrincipal,
  scope: QualityScope,
): Promise<void> {
  if (scope.kind === 'tenant') {
    throw new DomainError('forbidden', 'Qualidade da empresa é exclusiva do administrador');
  }
  if (scope.kind === 'queue') {
    await assertSupervisorQueueAccess(client, principal, scope.queueId);
    return;
  }
  const result = await client.query(
    `SELECT 1
     FROM sector_supervisors AS lead
     JOIN sectors AS sector
       ON sector.id = lead.sector_id AND sector.tenant_id = lead.tenant_id
     WHERE lead.tenant_id = $1
       AND lead.agent_id = $2
       AND lead.sector_id = $3
       AND lead.removed_at IS NULL
       AND sector.active = true`,
    [principal.tenantId, principal.agentId, scope.sectorId],
  );
  if (!result.rows[0]) throw new DomainError('forbidden', 'Setor fora do escopo do supervisor');
}
