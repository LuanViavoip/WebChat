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

beforeAll(async () => {
  app = await startTestApp();
});

afterAll(async () => {
  const admin = new pg.Client({ connectionString: process.env.MIGRATE_DATABASE_URL });
  await admin.connect();
  try {
    await admin.query(
      `DELETE FROM sla_policy_clocks WHERE policy_id IN (SELECT id FROM sla_policies WHERE queue_id = $1)`,
      [demoIds.queueSupportA],
    );
    await admin.query(`DELETE FROM sla_policies WHERE queue_id = $1`, [demoIds.queueSupportA]);
  } finally {
    await admin.end();
    await app.app.close();
  }
});

function hoursFromNow(hours: number): string {
  return new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
}

describe('política de SLA', () => {
  it('recusa o passado, encosta a vigência seguinte e não duplica o mesmo pedido', async () => {
    await expect(
      service().apply(otavio, {
        requestId: randomUUID(),
        command: {
          kind: 'sla.publish',
          queueId: demoIds.queueSupportA,
          effectiveFrom: new Date(Date.now() - 60_000).toISOString(),
          queueWaitThresholdSeconds: 120,
          firstResponseThresholdSeconds: 60,
        },
      }),
    ).rejects.toMatchObject({ code: 'invalid_state' });

    const requestId = randomUUID();
    const firstStart = hoursFromNow(1);
    const first = await service().apply(otavio, {
      requestId,
      command: {
        kind: 'sla.publish',
        queueId: demoIds.queueSupportA,
        effectiveFrom: firstStart,
        queueWaitThresholdSeconds: 120,
        firstResponseThresholdSeconds: 60,
      },
    });
    expect(first.result.receipt.replayed).toBe(false);
    const replay = await service().apply(otavio, {
      requestId,
      command: {
        kind: 'sla.publish',
        queueId: demoIds.queueSupportA,
        effectiveFrom: firstStart,
        queueWaitThresholdSeconds: 120,
        firstResponseThresholdSeconds: 60,
      },
    });
    expect(replay.result.receipt.replayed).toBe(true);

    const secondStart = hoursFromNow(2);
    await service().apply(otavio, {
      requestId: randomUUID(),
      command: {
        kind: 'sla.publish',
        queueId: demoIds.queueSupportA,
        effectiveFrom: secondStart,
        queueWaitThresholdSeconds: 90,
        firstResponseThresholdSeconds: 30,
      },
    });
    const rows = await withTenant(app.pool, demoIds.tenantA, (client) =>
      client.query<{ status: string; retired_at: Date | null }>(
        `SELECT status, retired_at FROM sla_policies WHERE queue_id = $1 ORDER BY effective_from`,
        [demoIds.queueSupportA],
      ),
    );
    expect(rows.rows).toHaveLength(2);
    expect(rows.rows[0]?.status).toBe('retired');
    expect(rows.rows[0]?.retired_at?.toISOString()).toBe(new Date(secondStart).toISOString());
    expect(rows.rows[1]?.status).toBe('active');
  });

  it('recusa vão futuro, fila de outro tenant e alteração de limiar', async () => {
    await withTenant(app.pool, demoIds.tenantA, (client) =>
      client.query(
        `UPDATE sla_policies
         SET status = 'retired', retired_at = now() + interval '3 hours'
         WHERE queue_id = $1 AND status = 'active'`,
        [demoIds.queueSupportA],
      ),
    );
    await expect(
      withTenant(app.pool, demoIds.tenantA, (client) =>
        client.query(
          `INSERT INTO sla_policies (tenant_id, queue_id, status, effective_from, created_by)
           VALUES ($1, $2, 'active', now() + interval '5 hours', $3)`,
          [demoIds.tenantA, demoIds.queueSupportA, demoIds.adminOtavio],
        ),
      ),
    ).rejects.toThrow(/future sla leaves a gap/i);
    await expect(
      service().apply(otavio, {
        requestId: randomUUID(),
        command: {
          kind: 'sla.publish',
          queueId: demoIds.queueSupportB,
          effectiveFrom: hoursFromNow(1),
          queueWaitThresholdSeconds: 60,
          firstResponseThresholdSeconds: 30,
        },
      }),
    ).rejects.toMatchObject({ code: 'not_found' });
    await expect(
      withTenant(app.pool, demoIds.tenantA, (client) =>
        client.query(`UPDATE sla_policy_clocks SET threshold_seconds = 1`),
      ),
    ).rejects.toThrow(/permission denied/i);
  });
});
