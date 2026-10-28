import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withTenant } from '../src/db/tenant.js';
import type { AgentPrincipal } from '../src/domain/types.js';
import { demoIds } from '../src/demo/ids.js';
import { CompanyAdministrationService } from '../src/modules/company-administration.js';
import { startTestApp, type TestApp } from './helpers.js';

let app: TestApp;
const service = () => new CompanyAdministrationService(app.pool);
const otavio: AgentPrincipal = {
  kind: 'admin',
  tenantId: demoIds.tenantA,
  agentId: demoIds.adminOtavio,
  sessionId: 'aaaaaaaa-1111-4111-8111-aaaaaaaaaa99',
  expiresAt: '2026-12-01T00:00:00.000Z',
  name: 'Otávio Ramos',
};
const sofia: AgentPrincipal = { ...otavio, kind: 'supervisor', agentId: demoIds.supervisorSofia };

beforeAll(async () => {
  app = await startTestApp();
});

afterAll(async () => {
  await withTenant(app.pool, demoIds.tenantA, async (client) => {
    await client.query(`DELETE FROM sites WHERE public_id = 'fase5-site'`);
    await client.query(`DELETE FROM queues WHERE name = 'Fila fase 5'`);
    await client.query(`DELETE FROM dispositions WHERE name = 'Classificação fase 5'`);
  });
  await app.app.close();
});

describe('comandos de configuração', () => {
  it('nega o comando ao supervisor', async () => {
    await expect(
      service().apply(sofia, {
        requestId: randomUUID(),
        command: { kind: 'company.rename', name: 'Outro nome' },
      }),
    ).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('cria site pausado e só aceita atendimento com origem explícita', async () => {
    const created = await service().apply(otavio, {
      requestId: randomUUID(),
      command: { kind: 'site.create', publicId: 'fase5-site', name: 'Site novo' },
    });
    const site = created.result.desk.sites.find((item) => item.publicId === 'fase5-site');
    expect(site?.acceptance).toEqual({ kind: 'paused', reason: 'Aguardando origens permitidas' });
    expect(site?.allowedOrigins).toEqual([]);
    await expect(
      service().apply(otavio, {
        requestId: randomUUID(),
        command: { kind: 'site.acceptance_set', siteId: site?.siteId ?? '', acceptance: { kind: 'accepting' } },
      }),
    ).rejects.toMatchObject({ code: 'invalid_state' });
  });

  it('repete o mesmo pedido sem duplicar fila nem auditoria e recusa outro payload', async () => {
    const requestId = randomUUID();
    const envelope = {
      requestId,
      command: { kind: 'queue.create' as const, name: 'Fila fase 5' },
    };
    const first = await service().apply(otavio, envelope);
    expect(first.result.receipt.replayed).toBe(false);
    const second = await service().apply(otavio, envelope);
    expect(second.result.receipt.replayed).toBe(true);
    expect(second.result.desk.queues.filter((queue) => queue.name === 'Fila fase 5')).toHaveLength(1);
    await expect(
      service().apply(otavio, { requestId, command: { kind: 'queue.create', name: 'Outra fila' } }),
    ).rejects.toMatchObject({ code: 'conflict' });
    const audits = await withTenant(app.pool, demoIds.tenantA, (client) =>
      client.query(
        `SELECT id FROM audit_events WHERE actor_id = $1 AND action = 'queue.create' AND resource_id IN (
           SELECT id FROM queues WHERE tenant_id = $2 AND name = 'Fila fase 5'
         )`,
        [demoIds.adminOtavio, demoIds.tenantA],
      ),
    );
    expect(audits.rows).toHaveLength(1);
  });

  it('desfaz o recibo quando a auditoria falha', async () => {
    const admin = new pg.Client({ connectionString: process.env.MIGRATE_DATABASE_URL });
    await admin.connect();
    await admin.query('REVOKE INSERT ON audit_events FROM webchat_app');
    try {
      await expect(
        service().apply(otavio, {
          requestId: randomUUID(),
          command: { kind: 'queue.create', name: 'Fila sem auditoria' },
        }),
      ).rejects.toThrow(/permission denied/i);
    } finally {
      await admin.query('GRANT INSERT ON audit_events TO webchat_app');
      await admin.end();
    }
    const left = await withTenant(app.pool, demoIds.tenantA, (client) =>
      client.query(`SELECT id FROM queues WHERE name = 'Fila sem auditoria'`),
    );
    expect(left.rows).toEqual([]);
    const receipts = await withTenant(app.pool, demoIds.tenantA, (client) =>
      client.query(`SELECT request_id FROM company_command_receipts WHERE command_kind = 'queue.create' AND status = 'in_flight'`),
    );
    expect(receipts.rows).toEqual([]);
  });

  it('trata dois envios simultâneos do mesmo pedido como um só efeito', async () => {
    const envelope = {
      requestId: randomUUID(),
      command: { kind: 'disposition.create' as const, name: 'Classificação fase 5' },
    };
    const results = await Promise.allSettled([service().apply(otavio, envelope), service().apply(otavio, envelope)]);
    const applied = results.filter((result) => result.status === 'fulfilled');
    expect(applied.length).toBeGreaterThan(0);
    const rows = await withTenant(app.pool, demoIds.tenantA, (client) =>
      client.query(`SELECT id FROM dispositions WHERE name = 'Classificação fase 5'`),
    );
    expect(rows.rows).toHaveLength(1);
    const audits = await withTenant(app.pool, demoIds.tenantA, (client) =>
      client.query(`SELECT id FROM audit_events WHERE action = 'disposition.create' AND resource_id = $1`, [
        rows.rows[0]?.id,
      ]),
    );
    expect(audits.rows).toHaveLength(1);
  });
});
