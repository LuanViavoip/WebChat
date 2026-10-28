import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withTenant } from '../src/db/tenant.js';
import {
  judgeFirstResponse,
  reconstructOperationalFacts,
  type ConversationTimelineEvent,
} from '../src/domain/quality-facts.js';
import type { AgentPrincipal } from '../src/domain/types.js';
import { demoIds } from '../src/demo/ids.js';
import { OperationalQualityService } from '../src/modules/operational-quality.js';
import { startTestApp, type TestApp } from './helpers.js';

const window = { from: '2026-10-01T00:00:00.000Z', to: '2026-10-28T00:00:00.000Z' };
const conversationId = 'cccccccc-1111-4111-8111-ccccccccccc9';

function event(type: ConversationTimelineEvent['type'], at: string, payload: Record<string, string> = {}): ConversationTimelineEvent {
  return { conversationId, type, at, payload };
}

describe('fatos de qualidade', () => {
  it('separa resposta, encerramento sem resposta e devolução sem violação', () => {
    const events = [
      event('queued', '2026-10-02T10:00:00.000Z', { queueId: demoIds.queueSupportA }),
      event('assigned', '2026-10-02T10:00:10.000Z', { agentId: demoIds.agentAna }),
      event('released', '2026-10-02T10:00:40.000Z', { agentId: demoIds.agentAna }),
      event('queued', '2026-10-02T10:01:00.000Z', { queueId: demoIds.queueSupportA }),
      event('assigned', '2026-10-02T10:01:30.000Z', { agentId: demoIds.agentAna }),
      event('classified', '2026-10-02T10:02:00.000Z', { dispositionId: demoIds.dispositionResolvedA }),
    ];
    const facts = reconstructOperationalFacts({
      events,
      agentReplies: [],
      window,
    });
    expect(facts.firstResponses.map((fact) => fact.kind)).toEqual([
      'handed_off_without_reply',
      'closed_without_reply',
    ]);
    const handedOff = facts.firstResponses[0];
    const closed = facts.firstResponses[1];
    if (!handedOff || !closed) throw new Error('fatos ausentes');
    expect(judgeFirstResponse(handedOff, { thresholdSeconds: 5 }).outcome).toBe('not_applicable');
    expect(judgeFirstResponse(closed, { thresholdSeconds: 5 }).outcome).toBe('breached');
    expect(facts.queueWaits.filter((fact) => fact.kind === 'completed')).toHaveLength(2);
    const answered = reconstructOperationalFacts({
      events: [
        event('queued', '2026-10-03T10:00:00.000Z', { queueId: demoIds.queueSupportA }),
        event('assigned', '2026-10-03T10:00:10.000Z', { agentId: demoIds.agentAna }),
        event('classified', '2026-10-03T10:00:40.000Z', { dispositionId: demoIds.dispositionResolvedA }),
      ],
      agentReplies: [{ conversationId, agentId: demoIds.agentAna, at: '2026-10-03T10:00:20.000Z' }],
      window,
    });
    expect(answered.firstResponses[0]).toMatchObject({ kind: 'answered', elapsedSeconds: 10 });
    expect(answered.queueWaits[0]).toMatchObject({ kind: 'completed', elapsedSeconds: 10 });
    expect(answered.handleTimes[0]).toMatchObject({ kind: 'closed_segment', elapsedSeconds: 30 });
  });
});

describe('relatório de qualidade', () => {
  let app: TestApp;
  const service = () => new OperationalQualityService(app.pool);
  const otavio: AgentPrincipal = {
    kind: 'admin',
    tenantId: demoIds.tenantA,
    agentId: demoIds.adminOtavio,
    sessionId: randomUUID(),
    expiresAt: '2026-12-01T00:00:00.000Z',
    name: 'Otávio Ramos',
  };
  const sofia: AgentPrincipal = { ...otavio, kind: 'supervisor', agentId: demoIds.supervisorSofia };
  const ana: AgentPrincipal = { ...otavio, kind: 'agent', agentId: demoIds.agentAna };
  const visitorId = randomUUID();
  const ownedConversation = randomUUID();

  beforeAll(async () => {
    app = await startTestApp();
    await withTenant(app.pool, demoIds.tenantA, async (client) => {
      const policyId = randomUUID();
      await client.query(`INSERT INTO visitors (id, tenant_id, site_id) VALUES ($1, $2, $3)`, [
        visitorId,
        demoIds.tenantA,
        demoIds.siteA,
      ]);
      await client.query(
        `INSERT INTO conversations (id, tenant_id, site_id, queue_id, visitor_id, status, queued_at, assigned_at, ended_at)
         VALUES ($1, $2, $3, $4, $5, 'closed', now(), now() + interval '10 seconds', now() + interval '40 seconds')`,
        [ownedConversation, demoIds.tenantA, demoIds.siteA, demoIds.queueSupportA, visitorId],
      );
      await client.query(
        `INSERT INTO conversation_events (tenant_id, conversation_id, type, payload, created_at)
         VALUES
           ($1, $2, 'queued', $3::jsonb, now()),
           ($1, $2, 'assigned', $4::jsonb, now() + interval '10 seconds'),
           ($1, $2, 'classified', $5::jsonb, now() + interval '40 seconds')`,
        [
          demoIds.tenantA,
          ownedConversation,
          JSON.stringify({ queueId: demoIds.queueSupportA }),
          JSON.stringify({ agentId: demoIds.agentAna }),
          JSON.stringify({ dispositionId: demoIds.dispositionResolvedA }),
        ],
      );
      await client.query(
        `INSERT INTO sla_policies (id, tenant_id, queue_id, status, effective_from, created_by)
         VALUES ($1, $2, $3, 'active', now(), $4)`,
        [policyId, demoIds.tenantA, demoIds.queueSupportA, demoIds.adminOtavio],
      );
      await client.query(
        `INSERT INTO sla_policy_clocks (policy_id, tenant_id, metric, threshold_seconds)
         VALUES ($1, $2, 'queue_wait', 120), ($1, $2, 'first_response', 60)`,
        [policyId, demoIds.tenantA],
      );
    });
  });

  afterAll(async () => {
    const admin = new pg.Client({ connectionString: process.env.MIGRATE_DATABASE_URL });
    await admin.connect();
    try {
      await admin.query(`DELETE FROM sla_policy_clocks WHERE policy_id IN (SELECT id FROM sla_policies WHERE queue_id = $1)`, [
        demoIds.queueSupportA,
      ]);
      await admin.query(`DELETE FROM sla_policies WHERE queue_id = $1`, [demoIds.queueSupportA]);
      await admin.query(`DELETE FROM conversation_events WHERE conversation_id = $1`, [ownedConversation]);
      await admin.query(`DELETE FROM conversations WHERE id = $1`, [ownedConversation]);
      await admin.query(`DELETE FROM visitors WHERE id = $1`, [visitorId]);
    } finally {
      await admin.end();
      await app.app.close();
    }
  });

  it('nega o agente e o supervisor fora da fila, e não mistura o outro tenant', async () => {
    const from = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const to = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const query = {
      scope: { kind: 'queue' as const, queueId: demoIds.queueSupportA },
      from,
      to,
    };
    await expect(service().report(ana, query)).rejects.toMatchObject({ code: 'forbidden' });
    await expect(
      service().report(sofia, { ...query, scope: { kind: 'queue', queueId: demoIds.queueSalesA } }),
    ).rejects.toMatchObject({ code: 'forbidden' });
    const report = await service().report(otavio, { scope: { kind: 'tenant' }, from, to });
    expect(report.queueWaits.completed).toBeGreaterThanOrEqual(1);
    expect(report.firstResponseCoverage.unansweredClosed).toBeGreaterThanOrEqual(1);
    expect(report.firstResponseCoverage.transferredUnanswered).toBe(0);
    expect(report.firstResponse.samples).toBe(0);
    expect(report.sla.firstResponse.breached).toBeGreaterThanOrEqual(1);
    await expect(
      service().report(otavio, {
        scope: { kind: 'tenant' },
        from,
        to: new Date(Date.parse(from) + 32 * 24 * 60 * 60 * 1000).toISOString(),
      }),
    ).rejects.toMatchObject({ code: 'invalid_payload' });
  });
});
