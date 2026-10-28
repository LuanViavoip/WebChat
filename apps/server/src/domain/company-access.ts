import type { CompanyCommand, QualityScope } from '@viavoip/protocol';
import type { PoolClient } from 'pg';
import { assertSupervisorQueueAccess } from './access.js';
import { DomainError } from './errors.js';
import type { Principal } from './types.js';

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
  switch (principal.kind) {
    case 'visitor':
    case 'agent':
      throw new DomainError('forbidden', 'Gestão exclusiva do administrador');
    case 'supervisor':
      await assertSupervisorCompanyAccess(client, principal, access);
      return;
    case 'admin':
      return;
    default: {
      const unexpected: never = principal;
      throw new DomainError('forbidden', `Principal inesperado: ${String(unexpected)}`);
    }
  }
}

async function assertSupervisorCompanyAccess(
  client: PoolClient,
  principal: Extract<Principal, { kind: 'supervisor' }>,
  access: CompanyAccess,
): Promise<void> {
  switch (access.capability) {
    case 'company.desk':
    case 'company.command':
    case 'audit.read':
      throw new DomainError('forbidden', 'Gestão exclusiva do administrador');
    case 'quality.report':
      await assertSupervisorQualityScope(client, principal, access.scope);
      return;
    default: {
      const unexpected: never = access;
      throw new DomainError('forbidden', `Capacidade inesperada: ${String(unexpected)}`);
    }
  }
}

async function assertSupervisorQualityScope(
  client: PoolClient,
  principal: Extract<Principal, { kind: 'supervisor' }>,
  scope: QualityScope,
): Promise<void> {
  switch (scope.kind) {
    case 'tenant':
      throw new DomainError('forbidden', 'Qualidade da empresa é exclusiva do administrador');
    case 'queue':
      await assertSupervisorQueueAccess(client, principal, scope.queueId);
      return;
    case 'sector': {
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
      return;
    }
    default: {
      const unexpected: never = scope;
      throw new DomainError('forbidden', `Escopo inesperado: ${String(unexpected)}`);
    }
  }
}
