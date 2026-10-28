import type { CompanyCommandEnvelope, CompanyCommandResult, CompanyDesk } from '@viavoip/protocol';
import type { Pool } from 'pg';
import { withTenant } from '../db/tenant.js';
import { assertCompanyAccess } from '../domain/company-access.js';
import type { AgentPrincipal } from '../domain/types.js';
import { executeCompanyCommand } from './company-commands.js';
import { readCompanyDesk } from './company-desk.js';
import { commandPayloadHash, withCommandReceipt } from './company-receipt.js';

export type CompanyCommandApplied = {
  result: CompanyCommandResult;
  revokedSessionIds: string[];
};

export class CompanyAdministrationService {
  constructor(private readonly pool: Pool) {}

  async load(principal: AgentPrincipal): Promise<CompanyDesk> {
    return withTenant(this.pool, principal.tenantId, async (client) => {
      await assertCompanyAccess(client, principal, { capability: 'company.desk' });
      return readCompanyDesk(client, principal.tenantId);
    });
  }

  async apply(principal: AgentPrincipal, envelope: CompanyCommandEnvelope): Promise<CompanyCommandApplied> {
    const revokedSessionIds: string[] = [];
    const result = await withTenant(this.pool, principal.tenantId, async (client) => {
      await assertCompanyAccess(client, principal, {
        capability: 'company.command',
        command: envelope.command.kind,
      });
      const recorded = await withCommandReceipt(
        client,
        {
          tenantId: principal.tenantId,
          actorId: principal.agentId,
          requestId: envelope.requestId,
          commandKind: envelope.command.kind,
          payloadHash: commandPayloadHash(envelope.command),
        },
        () => executeCompanyCommand(client, principal, envelope.command, revokedSessionIds),
      );
      return {
        desk: await readCompanyDesk(client, principal.tenantId),
        receipt: {
          requestId: envelope.requestId,
          replayed: recorded.replayed,
          appliedAt: recorded.appliedAt,
        },
      };
    });
    return { result, revokedSessionIds };
  }
}
