import type { CompanyCommandEnvelope, CompanyCommandResult, CompanyDesk } from '@viavoip/protocol';
import type { Pool } from 'pg';
import { withTenant } from '../db/tenant.js';
import { assertCompanyAccess } from '../domain/company-access.js';
import type { AgentPrincipal } from '../domain/types.js';
import { readCompanyDesk } from './company-desk.js';

export class CompanyAdministrationService {
  constructor(private readonly pool: Pool) {}

  async load(principal: AgentPrincipal): Promise<CompanyDesk> {
    return withTenant(this.pool, principal.tenantId, async (client) => {
      await assertCompanyAccess(client, principal, { capability: 'company.desk' });
      return readCompanyDesk(client, principal.tenantId);
    });
  }

  async apply(principal: AgentPrincipal, envelope: CompanyCommandEnvelope): Promise<CompanyCommandResult> {
    void this.pool;
    void principal;
    void envelope.requestId;
    switch (envelope.command.kind) {
      case 'agent.create':
      case 'agent.suspend':
      case 'agent.reactivate':
      case 'agent.role_change':
      case 'agent.queues_replace':
      case 'agent.activity_authority':
      case 'agent.credential_reset':
      case 'agent.sessions_revoke':
      case 'queue.create':
      case 'queue.rename':
      case 'disposition.create':
      case 'disposition.rename':
      case 'disposition.retire':
      case 'survey.publish':
      case 'company.rename':
      case 'company.concurrency_limit':
      case 'company.time_zone':
      case 'site.create':
      case 'site.appearance_replace':
      case 'site.acceptance_set':
      case 'site.origins_replace':
      case 'site.service_windows_replace':
      case 'sla.publish':
      case 'sla.retire':
        throw new Error('not implemented');
      default: {
        const unexpected: never = envelope.command;
        throw new Error(`not implemented: ${String(unexpected)}`);
      }
    }
  }
}
