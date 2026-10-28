import type { QualityQuery, QualityReport } from '@viavoip/protocol';
import type { Pool } from 'pg';
import type { AgentPrincipal } from '../domain/types.js';

export class OperationalQualityService {
  constructor(private readonly pool: Pool) {}

  async report(principal: AgentPrincipal, query: QualityQuery): Promise<QualityReport> {
    void this.pool;
    void principal;
    void query;
    throw new Error('not implemented');
  }
}
