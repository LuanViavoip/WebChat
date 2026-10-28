import type { AuditPage, AuditQuery } from '@viavoip/protocol';
import type { Pool } from 'pg';
import type { AgentPrincipal } from '../domain/types.js';

export class AuditQueryService {
  constructor(private readonly pool: Pool) {}

  async page(principal: AgentPrincipal, query: AuditQuery): Promise<AuditPage> {
    void this.pool;
    void principal;
    void query;
    throw new Error('not implemented');
  }
}
