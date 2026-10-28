import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withTenant } from '../src/db/tenant.js';
import { assertCompanyAccess } from '../src/domain/company-access.js';
import { DomainError } from '../src/domain/errors.js';
import type { AgentPrincipal, VisitorPrincipal } from '../src/domain/types.js';
import { demoAccounts, demoIds } from '../src/demo/ids.js';
import { CompanyAdministrationService } from '../src/modules/company-administration.js';
import { startTestApp, type TestApp } from './helpers.js';

let app: TestApp;
const service = () => new CompanyAdministrationService(app.pool);

function staff(kind: AgentPrincipal['kind'], agentId: string, tenantId = demoIds.tenantA): AgentPrincipal {
  return {
    kind,
    tenantId,
    agentId,
    sessionId: 'aaaaaaaa-1111-4111-8111-aaaaaaaaaa99',
    expiresAt: '2026-12-01T00:00:00.000Z',
    name: 'Teste',
  };
}

const visitor: VisitorPrincipal = {
  kind: 'visitor',
  tenantId: demoIds.tenantA,
  visitorId: 'aaaaaaaa-1111-4111-8111-aaaaaaaaaa98',
  siteId: demoIds.siteA,
  sessionId: 'aaaaaaaa-1111-4111-8111-aaaaaaaaaa97',
  expiresAt: '2026-12-01T00:00:00.000Z',
};

beforeAll(async () => {
  app = await startTestApp();
});

afterAll(async () => {
  await app.app.close();
});

describe('mesa da empresa', () => {
  it('entrega ao administrador só os recursos do próprio tenant', async () => {
    const desk = await service().load(staff('admin', demoIds.adminOtavio));
    expect(desk.company).toMatchObject({ name: 'Tenant A', slug: 'tenant-a', timeZone: 'America/Sao_Paulo' });
    expect(desk.sites.map((site) => site.publicId)).toEqual(['site_a']);
    expect(desk.agents.map((agent) => agent.email)).toContain(demoAccounts.otavio);
    expect(desk.agents.map((agent) => agent.email)).not.toContain(demoAccounts.carla);
    expect(desk.queues.map((queue) => queue.id).sort()).toEqual(
      [demoIds.queueSalesA, demoIds.queueSupportA].sort(),
    );
    expect(desk.survey.status).toBe('active');
  });

  it('nega mesa, comando e auditoria a agente, supervisor e visitante', async () => {
    await expect(service().load(staff('agent', demoIds.agentAna))).rejects.toMatchObject({ code: 'forbidden' });
    await expect(service().load(staff('supervisor', demoIds.supervisorSofia))).rejects.toMatchObject({
      code: 'forbidden',
    });
    await withTenant(app.pool, demoIds.tenantA, async (client) => {
      const denied = [
        staff('agent', demoIds.agentAna),
        staff('supervisor', demoIds.supervisorSofia),
        visitor,
      ] as const;
      for (const principal of denied) {
        await expect(
          assertCompanyAccess(client, principal, { capability: 'company.desk' }),
        ).rejects.toBeInstanceOf(DomainError);
        await expect(
          assertCompanyAccess(client, principal, { capability: 'company.command', command: 'company.rename' }),
        ).rejects.toMatchObject({ code: 'forbidden' });
        await expect(assertCompanyAccess(client, principal, { capability: 'audit.read' })).rejects.toMatchObject({
          code: 'forbidden',
        });
      }
    });
  });

  it('limita a qualidade do supervisor aos setores e filas dele', async () => {
    await withTenant(app.pool, demoIds.tenantA, async (client) => {
      const sofia = staff('supervisor', demoIds.supervisorSofia);
      await expect(
        assertCompanyAccess(client, sofia, {
          capability: 'quality.report',
          scope: { kind: 'queue', queueId: demoIds.queueSupportA },
        }),
      ).resolves.toBeUndefined();
      await expect(
        assertCompanyAccess(client, sofia, {
          capability: 'quality.report',
          scope: { kind: 'sector', sectorId: demoIds.sectorSupportA },
        }),
      ).resolves.toBeUndefined();
      await expect(
        assertCompanyAccess(client, sofia, {
          capability: 'quality.report',
          scope: { kind: 'queue', queueId: demoIds.queueSalesA },
        }),
      ).rejects.toMatchObject({ code: 'forbidden' });
      await expect(
        assertCompanyAccess(client, sofia, { capability: 'quality.report', scope: { kind: 'tenant' } }),
      ).rejects.toMatchObject({ code: 'forbidden' });
      await expect(
        assertCompanyAccess(client, staff('admin', demoIds.adminOtavio), {
          capability: 'quality.report',
          scope: { kind: 'tenant' },
        }),
      ).resolves.toBeUndefined();
    });
  });
});
