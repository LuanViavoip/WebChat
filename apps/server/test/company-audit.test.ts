import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withTenant } from '../src/db/tenant.js';
import type { AgentPrincipal } from '../src/domain/types.js';
import { demoIds } from '../src/demo/ids.js';
import { AuditQueryService } from '../src/modules/audit-query.js';
import { CompanyAdministrationService } from '../src/modules/company-administration.js';
import { startTestApp, type TestApp } from './helpers.js';

let app: TestApp;
const otavio: AgentPrincipal = {
  kind: 'admin',
  tenantId: demoIds.tenantA,
  agentId: demoIds.adminOtavio,
  sessionId: randomUUID(),
  expiresAt: '2026-12-01T00:00:00.000Z',
  name: 'Otávio Ramos',
};

beforeAll(async () => {
  app = await startTestApp();
});

afterAll(async () => {
  await app.app.close();
});

function commandRequest(command: { kind: 'company.rename'; name: string }): string {
  void command;
  return 'aaaaaaaa-1111-4111-8111-aaaaaaaaab01';
}

describe('leitura da auditoria', () => {
  it('pagina sem repetir a fronteira e esconde senha e papéis sem acesso', async () => {
    const command = { kind: 'company.rename' as const, name: 'Tenant A' };
    const service = new CompanyAdministrationService(app.pool);
    await service.apply(otavio, { requestId: randomUUID(), command });
    await service.apply(otavio, { requestId: randomUUID(), command });
    await service.apply(otavio, { requestId: commandRequest(command), command });
    await service.apply(otavio, { requestId: commandRequest(command), command });
    await withTenant(app.pool, demoIds.tenantA, (client) =>
      client.query(
        `INSERT INTO audit_events (tenant_id, actor_id, action, resource_type, resource_id, metadata)
         VALUES ($1, $2, 'legacy.action', 'tenant', $1, '{"password":"segredo"}'::jsonb)`,
        [demoIds.tenantA, demoIds.adminOtavio],
      ),
    );
    const audit = new AuditQueryService(app.pool, 1);
    const first = await audit.page(otavio, { action: 'company.rename' });
    expect(first.entries).toHaveLength(1);
    expect(first.nextCursor).toBeTruthy();
    const second = await audit.page(otavio, { action: 'company.rename', cursor: first.nextCursor ?? '' });
    expect(second.entries.map((entry) => entry.id)).not.toContain(first.entries[0]?.id);
    const legacy = await audit.page(otavio, {});
    const unknown = legacy.entries.find((entry) => entry.action.kind === 'unrecognized');
    expect(unknown?.action).toEqual({ kind: 'unrecognized', raw: 'legacy.action' });
    expect(JSON.stringify(legacy)).not.toContain('segredo');
    await expect(audit.page({ ...otavio, kind: 'supervisor', agentId: demoIds.supervisorSofia }, {})).rejects.toMatchObject({
      code: 'forbidden',
    });
    await expect(audit.page({ ...otavio, kind: 'agent', agentId: demoIds.agentAna }, {})).rejects.toMatchObject({
      code: 'forbidden',
    });
  });
});
