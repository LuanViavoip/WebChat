import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withTenant } from '../src/db/tenant.js';
import { demoIds } from '../src/demo/ids.js';
import { startTestApp, type TestApp } from './helpers.js';

let app: TestApp;

beforeAll(async () => {
  app = await startTestApp();
});

afterAll(async () => {
  await app.app.close();
});

describe('migration da fase 5', () => {
  it('força RLS nas tabelas novas e não guarda mesa no recibo', async () => {
    const flags = await app.pool.query<{ relname: string; forced: boolean }>(
      `SELECT rel.relname, rel.relforcerowsecurity AS forced
       FROM pg_class AS rel
       JOIN pg_namespace AS namespace ON namespace.oid = rel.relnamespace
       WHERE namespace.nspname = 'public'
         AND rel.relname IN (
           'company_command_receipts',
           'sla_policies',
           'sla_policy_clocks',
           'site_service_windows'
         )
       ORDER BY rel.relname`,
    );
    expect(flags.rows.map((row) => row.relname)).toEqual([
      'company_command_receipts',
      'site_service_windows',
      'sla_policies',
      'sla_policy_clocks',
    ]);
    expect(flags.rows.every((row) => row.forced)).toBe(true);
    const columns = await app.pool.query<{ column_name: string }>(
      `SELECT column_name
       FROM information_schema.columns
       WHERE table_name = 'company_command_receipts'`,
    );
    expect(columns.rows.map((row) => row.column_name)).not.toContain('response');
  });

  it('nega senha e atualização da auditoria ao papel da aplicação', async () => {
    await expect(
      withTenant(app.pool, demoIds.tenantA, (client) => client.query('SELECT password_hash FROM agents')),
    ).rejects.toThrow(/permission denied/i);
    await expect(
      withTenant(app.pool, demoIds.tenantA, (client) =>
        client.query(`UPDATE audit_events SET action = 'alterado' WHERE tenant_id = $1`, [demoIds.tenantA]),
      ),
    ).rejects.toThrow(/permission denied/i);
  });

  it('recusa SLA retroativo, sobreposição e site aceitando sem origem', async () => {
    await expect(
      withTenant(app.pool, demoIds.tenantA, (client) =>
        client.query(
          `INSERT INTO sla_policies (tenant_id, queue_id, status, effective_from, created_by)
           VALUES ($1, $2, 'active', now() - interval '1 minute', $3)`,
          [demoIds.tenantA, demoIds.queueSupportA, demoIds.adminOtavio],
        ),
      ),
    ).rejects.toThrow(/retroactive sla/i);

    const future = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    await withTenant(app.pool, demoIds.tenantA, async (client) => {
      const policy = await client.query<{ id: string }>(
        `INSERT INTO sla_policies (tenant_id, queue_id, status, effective_from, created_by)
         VALUES ($1, $2, 'active', $3, $4)
         RETURNING id`,
        [demoIds.tenantA, demoIds.queueSalesA, future, demoIds.adminOtavio],
      );
      const policyId = policy.rows[0]?.id;
      await client.query(
        `INSERT INTO sla_policy_clocks (policy_id, tenant_id, metric, threshold_seconds)
         VALUES ($1, $2, 'queue_wait', 60), ($1, $2, 'first_response', 30)`,
        [policyId, demoIds.tenantA],
      );
    });

    await expect(
      withTenant(app.pool, demoIds.tenantA, (client) =>
        client.query(
          `INSERT INTO sla_policies (tenant_id, queue_id, status, effective_from, created_by)
           VALUES ($1, $2, 'active', now() + interval '2 hours', $3)`,
          [demoIds.tenantA, demoIds.queueSalesA, demoIds.adminOtavio],
        ),
      ),
    ).rejects.toThrow(/open sla|overlap|exclusion/i);

    await expect(
      withTenant(app.pool, demoIds.tenantA, (client) =>
        client.query(
          `UPDATE sites
           SET acceptance = 'accepting', pause_reason = NULL, allowed_origins = '{}'
           WHERE id = $1`,
          [demoIds.siteA],
        ),
      ),
    ).rejects.toThrow(/allowed origins/i);
  });
});
