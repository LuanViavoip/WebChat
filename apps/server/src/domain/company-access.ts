import type { CompanyCommand, QualityScope } from '@viavoip/protocol';
import type { PoolClient } from 'pg';
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
    case 'supervisor':
    case 'admin':
      void client;
      void access;
      throw new Error('not implemented');
    default: {
      const unexpected: never = principal;
      throw new Error(`not implemented: ${String(unexpected)}`);
    }
  }
}
