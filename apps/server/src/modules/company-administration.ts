import type { CompanyCommand, CompanyDesk } from '@viavoip/protocol';
import type { Pool } from 'pg';
import type { AgentPrincipal } from '../domain/types.js';

export class CompanyAdministrationService {
  constructor(private readonly pool: Pool) {}

  async load(principal: AgentPrincipal): Promise<CompanyDesk> {
    void this.pool;
    void principal;
    throw new Error('not implemented');
  }

  async apply(principal: AgentPrincipal, command: CompanyCommand): Promise<CompanyDesk> {
    void this.pool;
    void principal;
    switch (command.kind) {
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
        const unexpected: never = command;
        throw new Error(`not implemented: ${String(unexpected)}`);
      }
    }
  }
}
