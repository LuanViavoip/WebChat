import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { auditPageSchema, companyCommandResultSchema, companyDeskSchema, qualityReportSchema } from '@viavoip/protocol';
import { withTenant } from '../src/db/tenant.js';
import { demoAccounts, demoIds, demoPassword, demoSites } from '../src/demo/ids.js';
import { login, openVisitor, postJson, startTestApp, type TestApp } from './helpers.js';

let app: TestApp;

beforeAll(async () => {
  app = await startTestApp();
});

afterAll(async () => {
  await app.app.close();
});

describe('rotas administrativas', () => {
  it('exige sessão e não chama o SM', async () => {
    const calls = app.sm.calls.length;
    const missing = await fetch(`${app.baseUrl}/company/desk`);
    expect(missing.status).toBe(401);
    const otavio = await login(app.baseUrl, demoAccounts.otavio, demoPassword);
    const desk = await fetch(`${app.baseUrl}/company/desk`, {
      headers: { authorization: `Bearer ${otavio.token}` },
    });
    expect(desk.status).toBe(200);
    expect(companyDeskSchema.parse(await desk.json()).company.slug).toBe('tenant-a');
    const requestId = randomUUID();
    const command = { kind: 'company.rename', name: 'Tenant A' };
    const first = await postJson(
      `${app.baseUrl}/company/commands`,
      { requestId, command },
      otavio.token,
    );
    expect(first.status).toBe(200);
    expect(companyCommandResultSchema.parse(first.payload).receipt.replayed).toBe(false);
    const replay = await postJson(
      `${app.baseUrl}/company/commands`,
      { requestId, command },
      otavio.token,
    );
    expect(companyCommandResultSchema.parse(replay.payload).receipt.replayed).toBe(true);
    const from = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const to = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const quality = await fetch(
      `${app.baseUrl}/quality/report?scopeKind=tenant&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
      { headers: { authorization: `Bearer ${otavio.token}` } },
    );
    expect(quality.status).toBe(200);
    const audit = await fetch(`${app.baseUrl}/audit/events`, {
      headers: { authorization: `Bearer ${otavio.token}` },
    });
    expect(audit.status).toBe(200);
    const ana = await login(app.baseUrl, demoAccounts.ana, demoPassword);
    const denied = await fetch(`${app.baseUrl}/company/desk`, {
      headers: { authorization: `Bearer ${ana.token}` },
    });
    expect(denied.status).toBe(403);
    expect(app.sm.calls.length).toBe(calls);
  });
});

async function getJson(url: string, token?: string) {
  const headers: Record<string, string> = {};
  if (token) headers.authorization = `Bearer ${token}`;
  const response = await fetch(url, { headers });
  const text = await response.text();
  return { status: response.status, text, payload: text ? (JSON.parse(text) as unknown) : null };
}

function reportUrl(baseUrl: string, query: { scopeKind: string; queueId?: string; sectorId?: string; from: string; to: string }): string {
  const params = new URLSearchParams({ scopeKind: query.scopeKind, from: query.from, to: query.to });
  if (query.queueId) params.set('queueId', query.queueId);
  if (query.sectorId) params.set('sectorId', query.sectorId);
  return `${baseUrl}/quality/report?${params.toString()}`;
}

describe('rotas HTTP de gestão, qualidade e auditoria', () => {
  const from = '2026-06-01T00:00:00.000Z';
  const to = '2026-06-02T00:00:00.000Z';
  const visitorA = randomUUID();
  const visitorB = randomUUID();
  const visitorIds: string[] = [visitorA, visitorB];
  const conversationIds: string[] = [];
  const policyIds: string[] = [];

  beforeAll(async () => {
    const admin = new pg.Client({ connectionString: process.env.MIGRATE_DATABASE_URL });
    await admin.connect();
    try {
      await admin.query('ALTER TABLE sla_policies DISABLE TRIGGER sla_policies_publication');
      await admin.query('BEGIN');
      const older = randomUUID();
      const newer = randomUUID();
      policyIds.push(older, newer);
      await admin.query(
        `INSERT INTO sla_policies (id, tenant_id, queue_id, status, effective_from, retired_at, created_by)
         VALUES
           ($1, $2, $3, 'retired', '2026-05-01T00:00:00.000Z', '2026-08-01T00:00:00.000Z', $4),
           ($5, $2, $3, 'active', '2026-08-01T00:00:00.000Z', NULL, $4)`,
        [older, demoIds.tenantA, demoIds.queueSupportA, demoIds.adminOtavio, newer],
      );
      await admin.query(
        `INSERT INTO sla_policy_clocks (policy_id, tenant_id, metric, threshold_seconds)
         VALUES
           ($1, $2, 'queue_wait', 20), ($1, $2, 'first_response', 30),
           ($3, $2, 'queue_wait', 1), ($3, $2, 'first_response', 1)`,
        [older, demoIds.tenantA, newer],
      );
      await admin.query('COMMIT');
    } catch (error) {
      await admin.query('ROLLBACK');
      throw error;
    } finally {
      await admin.query('ALTER TABLE sla_policies ENABLE TRIGGER sla_policies_publication');
      await admin.end();
    }

    await withTenant(app.pool, demoIds.tenantA, async (client) => {
      const rows: { queueId: string; status: string; events: { type: string; at: string; payload: Record<string, string> }[]; replyAt?: string }[] = [
        {
          queueId: demoIds.queueSupportA,
          status: 'closed',
          events: [
            { type: 'queued', at: '2026-06-01T10:00:00.000Z', payload: { queueId: demoIds.queueSupportA } },
            { type: 'assigned', at: '2026-06-01T10:00:10.000Z', payload: { agentId: demoIds.agentAna } },
            { type: 'classified', at: '2026-06-01T10:01:10.000Z', payload: { dispositionId: demoIds.dispositionResolvedA } },
          ],
          replyAt: '2026-06-01T10:00:25.000Z',
        },
        {
          queueId: demoIds.queueSupportA,
          status: 'closed',
          events: [
            { type: 'queued', at: '2026-06-01T10:10:00.000Z', payload: { queueId: demoIds.queueSupportA } },
            { type: 'assigned', at: '2026-06-01T10:10:30.000Z', payload: { agentId: demoIds.agentAna } },
            { type: 'classified', at: '2026-06-01T10:12:10.000Z', payload: { dispositionId: demoIds.dispositionResolvedA } },
          ],
          replyAt: '2026-06-01T10:11:10.000Z',
        },
        {
          queueId: demoIds.queueSupportA,
          status: 'closed',
          events: [
            { type: 'queued', at: '2026-06-01T11:00:00.000Z', payload: { queueId: demoIds.queueSupportA } },
            { type: 'assigned', at: '2026-06-01T11:00:40.000Z', payload: { agentId: demoIds.agentAna } },
            { type: 'classified', at: '2026-06-01T11:02:00.000Z', payload: { dispositionId: demoIds.dispositionResolvedA } },
          ],
          replyAt: '2026-06-01T11:01:00.000Z',
        },
        {
          queueId: demoIds.queueSupportA,
          status: 'closed',
          events: [
            { type: 'queued', at: '2026-06-01T12:00:00.000Z', payload: { queueId: demoIds.queueSupportA } },
            { type: 'assigned', at: '2026-06-01T12:00:05.000Z', payload: { agentId: demoIds.agentAna } },
            { type: 'classified', at: '2026-06-01T12:00:50.000Z', payload: { dispositionId: demoIds.dispositionResolvedA } },
          ],
        },
        {
          queueId: demoIds.queueSupportA,
          status: 'queued',
          events: [
            { type: 'queued', at: '2026-06-01T13:00:00.000Z', payload: { queueId: demoIds.queueSupportA } },
            { type: 'assigned', at: '2026-06-01T13:00:08.000Z', payload: { agentId: demoIds.agentAna } },
            { type: 'released', at: '2026-06-01T13:00:20.000Z', payload: { agentId: demoIds.agentAna } },
          ],
        },
        {
          queueId: demoIds.queueSupportA,
          status: 'assigned',
          events: [
            { type: 'queued', at: '2026-06-01T14:00:00.000Z', payload: { queueId: demoIds.queueSupportA } },
            { type: 'assigned', at: '2026-06-01T14:00:12.000Z', payload: { agentId: demoIds.agentAna } },
            { type: 'classified', at: '2026-06-03T00:00:00.000Z', payload: { dispositionId: demoIds.dispositionResolvedA } },
          ],
        },
        {
          queueId: demoIds.queueSalesA,
          status: 'queued',
          events: [
            { type: 'queued', at: '2026-06-01T15:00:00.000Z', payload: { queueId: demoIds.queueSupportA } },
            { type: 'assigned', at: '2026-06-01T15:00:50.000Z', payload: { agentId: demoIds.agentAna } },
            { type: 'transferred', at: '2026-06-01T15:01:00.000Z', payload: { toQueueId: demoIds.queueSalesA } },
          ],
        },
      ];
      for (const row of rows) {
        const id = randomUUID();
        const visitorId = randomUUID();
        conversationIds.push(id);
        visitorIds.push(visitorId);
        await client.query(`INSERT INTO visitors (id, tenant_id, site_id) VALUES ($1, $2, $3)`, [
          visitorId,
          demoIds.tenantA,
          demoIds.siteA,
        ]);
        await client.query(
          `INSERT INTO conversations (id, tenant_id, site_id, queue_id, visitor_id, status, queued_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [id, demoIds.tenantA, demoIds.siteA, row.queueId, visitorId, row.status, row.events[0]?.at],
        );
        for (const item of row.events) {
          await client.query(
            `INSERT INTO conversation_events (tenant_id, conversation_id, type, payload, created_at)
             VALUES ($1, $2, $3, $4::jsonb, $5)`,
            [demoIds.tenantA, id, item.type, JSON.stringify(item.payload), item.at],
          );
        }
        if (row.replyAt) {
          await client.query(
            `INSERT INTO messages (tenant_id, conversation_id, sender_type, sender_id, request_id, body, created_at)
             VALUES ($1, $2, 'agent', $3, $4, 'resposta', $5)`,
            [demoIds.tenantA, id, demoIds.agentAna, randomUUID(), row.replyAt],
          );
        }
      }
    });
    await withTenant(app.pool, demoIds.tenantB, async (client) => {
      await client.query(`INSERT INTO visitors (id, tenant_id, site_id) VALUES ($1, $2, $3)`, [
        visitorB,
        demoIds.tenantB,
        demoIds.siteB,
      ]);
      const id = randomUUID();
      conversationIds.push(id);
      await client.query(
        `INSERT INTO conversations (id, tenant_id, site_id, queue_id, visitor_id, status, queued_at)
         VALUES ($1, $2, $3, $4, $5, 'assigned', $6)`,
        [id, demoIds.tenantB, demoIds.siteB, demoIds.queueSupportB, visitorB, '2026-06-01T16:00:00.000Z'],
      );
      await client.query(
        `INSERT INTO conversation_events (tenant_id, conversation_id, type, payload, created_at)
         VALUES
           ($1, $2, 'queued', $3::jsonb, '2026-06-01T16:00:00.000Z'),
           ($1, $2, 'assigned', $4::jsonb, '2026-06-01T16:16:39.000Z')`,
        [demoIds.tenantB, id, JSON.stringify({ queueId: demoIds.queueSupportB }), JSON.stringify({ agentId: demoIds.agentCarla })],
      );
    });
  });

  afterAll(async () => {
    const admin = new pg.Client({ connectionString: process.env.MIGRATE_DATABASE_URL });
    await admin.connect();
    try {
      await admin.query(`DELETE FROM messages WHERE conversation_id = ANY($1::uuid[])`, [conversationIds]);
      await admin.query(`DELETE FROM conversation_events WHERE conversation_id = ANY($1::uuid[])`, [conversationIds]);
      await admin.query(`DELETE FROM conversations WHERE id = ANY($1::uuid[])`, [conversationIds]);
      await admin.query(`DELETE FROM visitors WHERE id = ANY($1::uuid[])`, [visitorIds]);
      await admin.query(`DELETE FROM sla_policy_clocks WHERE policy_id = ANY($1::uuid[])`, [policyIds]);
      await admin.query(`DELETE FROM sla_policies WHERE id = ANY($1::uuid[])`, [policyIds]);
    } finally {
      await admin.end();
    }
  });

  it('nega mesa, comando, auditoria e qualidade a quem não tem o papel', async () => {
    const missing = await getJson(`${app.baseUrl}/audit/events`);
    expect(missing.status).toBe(401);
    const visitor = await openVisitor(app.baseUrl, demoSites.a);
    const visitorAudit = await getJson(`${app.baseUrl}/audit/events`, visitor.session.token);
    expect(visitorAudit.status).toBe(401);
    visitor.socket.disconnect();
    const ana = await login(app.baseUrl, demoAccounts.ana, demoPassword);
    const sofia = await login(app.baseUrl, demoAccounts.sofia, demoPassword);
    for (const token of [ana.token, sofia.token]) {
      expect((await getJson(`${app.baseUrl}/company/desk`, token)).status).toBe(403);
      expect((await getJson(`${app.baseUrl}/audit/events`, token)).status).toBe(403);
      expect(
        (await postJson(`${app.baseUrl}/company/commands`, { requestId: randomUUID(), command: { kind: 'company.rename', name: 'Não' } }, token)).status,
      ).toBe(403);
    }
    expect((await getJson(reportUrl(app.baseUrl, { scopeKind: 'tenant', from, to }), ana.token)).status).toBe(403);
    expect((await getJson(reportUrl(app.baseUrl, { scopeKind: 'tenant', from, to }), sofia.token)).status).toBe(403);
    expect((await getJson(reportUrl(app.baseUrl, { scopeKind: 'queue', queueId: demoIds.queueSalesA, from, to }), sofia.token)).status).toBe(403);
    expect((await getJson(reportUrl(app.baseUrl, { scopeKind: 'queue', queueId: demoIds.queueSupportA, from, to }), sofia.token)).status).toBe(200);
    const poisoned = await postJson(
      `${app.baseUrl}/company/commands`,
      { requestId: randomUUID(), command: { kind: 'company.rename', name: 'Tenant A', tenantId: demoIds.tenantB } },
      (await login(app.baseUrl, demoAccounts.otavio, demoPassword)).token,
    );
    expect(poisoned.status).toBe(400);
  });

  it('não deixa a empresa A ler nem alterar a empresa B', async () => {
    const otavio = await login(app.baseUrl, demoAccounts.otavio, demoPassword);
    const renata = await login(app.baseUrl, demoAccounts.renata, demoPassword);
    const desk = companyDeskSchema.parse((await getJson(`${app.baseUrl}/company/desk`, otavio.token)).payload);
    expect(desk.company.slug).toBe('tenant-a');
    expect(desk.queues.map((queue) => queue.id)).not.toContain(demoIds.queueSupportB);
    const foreign = await postJson(
      `${app.baseUrl}/company/commands`,
      { requestId: randomUUID(), command: { kind: 'queue.rename', queueId: demoIds.queueSupportB, name: 'Invadida' } },
      otavio.token,
    );
    expect(foreign.status).toBe(404);
    const foreignReport = await getJson(reportUrl(app.baseUrl, { scopeKind: 'queue', queueId: demoIds.queueSupportB, from, to }), otavio.token);
    expect(foreignReport.status).toBe(404);
    const own = qualityReportSchema.parse((await getJson(reportUrl(app.baseUrl, { scopeKind: 'queue', queueId: demoIds.queueSupportA, from, to }), otavio.token)).payload);
    const otherCompany = qualityReportSchema.parse(
      (await getJson(reportUrl(app.baseUrl, { scopeKind: 'queue', queueId: demoIds.queueSupportB, from, to }), renata.token)).payload,
    );
    expect(own.queueWait.totalSeconds).toBe(155);
    expect(otherCompany.queueWait.totalSeconds).toBe(999);
    expect(JSON.stringify(own)).not.toContain('999');
    const secret = `segredo-${randomUUID()}`;
    const foreignAudit = await withTenant(app.pool, demoIds.tenantB, (client) =>
      client.query<{ id: string }>(
        `INSERT INTO audit_events (tenant_id, actor_id, action, resource_type, resource_id, metadata)
         VALUES ($1, $2, 'company.rename', 'tenant', $1, $3::jsonb)
         RETURNING id`,
        [demoIds.tenantB, demoIds.supervisorRenata, JSON.stringify({ password: secret })],
      ),
    );
    const auditFrom = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const auditTo = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const audit = await getJson(
      `${app.baseUrl}/audit/events?from=${encodeURIComponent(auditFrom)}&to=${encodeURIComponent(auditTo)}`,
      otavio.token,
    );
    expect(audit.status).toBe(200);
    expect(audit.text).not.toContain(secret);
    expect(audit.text).not.toContain(foreignAudit.rows[0]?.id ?? 'ausente');
  });

  it('confere p50, p90 e a cobertura da primeira resposta na rota HTTP', async () => {
    const otavio = await login(app.baseUrl, demoAccounts.otavio, demoPassword);
    const report = qualityReportSchema.parse(
      (await getJson(reportUrl(app.baseUrl, { scopeKind: 'queue', queueId: demoIds.queueSupportA, from, to }), otavio.token)).payload,
    );
    // Esperas 5, 8, 10, 12, 30, 40 e 50. n=7. p50 = índice 3 → 12. p90 = índice 6 → 50.
    expect(report.queueWait).toEqual({ samples: 7, totalSeconds: 155, averageSeconds: 155 / 7, p50Seconds: 12, p90Seconds: 50, maxSeconds: 50 });
    // Respostas 15, 20 e 40. n=3. p50 = índice 1 → 20. p90 = índice 2 → 40.
    expect(report.firstResponse).toEqual({ samples: 3, totalSeconds: 75, averageSeconds: 25, p50Seconds: 20, p90Seconds: 40, maxSeconds: 40 });
    // Tratos 10, 12, 45, 60, 80 e 100. n=6. p50 = índice 2 → 45. p90 = índice 5 → 100.
    expect(report.handleTime).toEqual({ samples: 6, totalSeconds: 307, averageSeconds: 307 / 6, p50Seconds: 45, p90Seconds: 100, maxSeconds: 100 });
    // A devolução das 13:00 reabre a espera na mesma fila e ela segue aberta no fim da janela.
    expect(report.queueWaits).toEqual({ completed: 7, abandoned: 0, open: 1, unreadable: 0 });
    expect(report.firstResponseCoverage).toEqual({
      answered: 3,
      unansweredClosed: 1,
      transferredUnanswered: 2,
      stillOpen: 1,
      unreadable: 0,
    });
    // Política de maio (20s/30s). A de agosto, com limiar 1s, não rejulga junho.
    expect(report.sla).toEqual({
      queueWait: { within: 4, breached: 3, notApplicable: 1 },
      firstResponse: { within: 2, breached: 2, notApplicable: 3 },
    });
    expect(report.completions).toEqual({ classified: 4 });
    const sales = qualityReportSchema.parse(
      (await getJson(reportUrl(app.baseUrl, { scopeKind: 'queue', queueId: demoIds.queueSalesA, from, to }), otavio.token)).payload,
    );
    expect(sales.queueWaits).toEqual({ completed: 0, abandoned: 0, open: 1, unreadable: 0 });
    expect(sales.queueWait.samples).toBe(0);
  });

  it('pagina a auditoria por HTTP sem repetir a fronteira e esconde senha e evento antigo', async () => {
    const otavio = await login(app.baseUrl, demoAccounts.otavio, demoPassword);
    const stamp = `senha-http-${randomUUID()}`;
    await withTenant(app.pool, demoIds.tenantA, (client) =>
      client.query(
        `INSERT INTO audit_events (tenant_id, actor_id, action, resource_type, resource_id, metadata, created_at)
         SELECT $1, $2, 'company.rename', 'tenant', $1, '{}'::jsonb, timestamp '2026-09-01 00:00:00+00' + (g.i || ' seconds')::interval
         FROM generate_series(0, 50) AS g(i)`,
        [demoIds.tenantA, demoIds.adminOtavio],
      ),
    );
    const legacy = await withTenant(app.pool, demoIds.tenantA, (client) =>
      client.query<{ id: string; marker: string }>(
        `INSERT INTO audit_events (tenant_id, actor_id, action, resource_type, resource_id, metadata, created_at)
         VALUES
           ($1, $2, 'legacy.action', 'tenant', $1, $3::jsonb, '2026-09-01T00:00:30.000Z'),
           ($1, $2, 'company.time_zone', 'tenant', $1, '{}'::jsonb, now() - interval '48 hours'),
           ($1, $2, 'company.time_zone', 'tenant', $1, '{}'::jsonb, now())
         RETURNING id,
           CASE
             WHEN action = 'legacy.action' THEN 'legacy'
             WHEN created_at < now() - interval '24 hours' THEN 'old'
             ELSE 'recent'
           END AS marker`,
        [demoIds.tenantA, demoIds.adminOtavio, JSON.stringify({ password: stamp })],
      ),
    );
    const marked = Object.fromEntries(legacy.rows.map((row) => [row.marker, row.id]));
    const first = auditPageSchema.parse(
      (await getJson(
        `${app.baseUrl}/audit/events?action=company.rename&from=${encodeURIComponent('2026-09-01T00:00:00.000Z')}&to=${encodeURIComponent('2026-09-01T00:02:00.000Z')}`,
        otavio.token,
      )).payload,
    );
    expect(first.entries).toHaveLength(50);
    expect(first.nextCursor).toBeTruthy();
    const second = auditPageSchema.parse(
      (await getJson(
        `${app.baseUrl}/audit/events?action=company.rename&from=${encodeURIComponent('2026-09-01T00:00:00.000Z')}&to=${encodeURIComponent('2026-09-01T00:02:00.000Z')}&cursor=${encodeURIComponent(first.nextCursor ?? '')}`,
        otavio.token,
      )).payload,
    );
    expect(second.entries).toHaveLength(1);
    expect(second.entries.map((entry) => entry.id)).not.toContain(first.entries[0]?.id);
    const seen = new Set([...first.entries, ...second.entries].map((entry) => entry.id));
    expect(seen.size).toBe(51);
    const legacyPage = auditPageSchema.parse(
      (await getJson(
        `${app.baseUrl}/audit/events?from=${encodeURIComponent('2026-09-01T00:00:00.000Z')}&to=${encodeURIComponent('2026-09-01T00:02:00.000Z')}`,
        otavio.token,
      )).payload,
    );
    expect(legacyPage.entries.some((entry) => entry.action.kind === 'unrecognized' && entry.action.raw === 'legacy.action')).toBe(true);
    expect(JSON.stringify(legacyPage)).not.toContain(stamp);
    const recent = auditPageSchema.parse((await getJson(`${app.baseUrl}/audit/events?action=company.time_zone`, otavio.token)).payload);
    expect(recent.entries.map((entry) => entry.id)).toContain(marked.recent);
    expect(recent.entries.map((entry) => entry.id)).not.toContain(marked.old);
  });

  it('aplica um requestId uma vez sob concorrência e de novo depois do restart', async () => {
    const first = await startTestApp();
    const requestId = randomUUID();
    const command = { kind: 'disposition.create' as const, name: `Classificação http ${requestId.slice(0, 8)}` };
    try {
      const otavio = await login(first.baseUrl, demoAccounts.otavio, demoPassword);
      const raced = await Promise.all([
        postJson(`${first.baseUrl}/company/commands`, { requestId, command }, otavio.token),
        postJson(`${first.baseUrl}/company/commands`, { requestId, command }, otavio.token),
      ]);
      const applied = raced.filter((result) => result.status === 200 && companyCommandResultSchema.parse(result.payload).receipt.replayed === false);
      expect(applied).toHaveLength(1);
      const rows = await withTenant(first.pool, demoIds.tenantA, (client) =>
        client.query(`SELECT id FROM dispositions WHERE tenant_id = $1 AND name = $2`, [demoIds.tenantA, command.name]),
      );
      expect(rows.rows).toHaveLength(1);
    } finally {
      await first.app.close();
    }
    const restarted = await startTestApp();
    try {
      const again = await login(restarted.baseUrl, demoAccounts.otavio, demoPassword);
      const replay = await postJson(`${restarted.baseUrl}/company/commands`, { requestId, command }, again.token);
      expect(replay.status).toBe(200);
      expect(companyCommandResultSchema.parse(replay.payload).receipt.replayed).toBe(true);
      const after = await withTenant(restarted.pool, demoIds.tenantA, (client) =>
        client.query(`SELECT id FROM dispositions WHERE tenant_id = $1 AND name = $2`, [demoIds.tenantA, command.name]),
      );
      expect(after.rows).toHaveLength(1);
      const audits = await withTenant(restarted.pool, demoIds.tenantA, (client) =>
        client.query(`SELECT id FROM audit_events WHERE action = 'disposition.create' AND resource_id = $1`, [after.rows[0]?.id]),
      );
      expect(audits.rows).toHaveLength(1);
    } finally {
      await restarted.app.close();
    }
  });
});
