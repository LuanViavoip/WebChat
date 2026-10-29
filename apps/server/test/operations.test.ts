import { activityAssignmentAckSchema, activityHistoryAckSchema, authMeSchema, presenceAckSchema } from '@viavoip/protocol';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withTenant } from '../src/db/tenant.js';
import { demoAccounts, demoIds, demoPassword } from '../src/demo/ids.js';
import { connectSocket, emitAck, login, startTestApp, waitConnect, type TestApp } from './helpers.js';

let app: TestApp;

beforeAll(async () => {
  app = await startTestApp();
});

afterAll(async () => {
  await app.app.close();
});

describe('presença e atividades', () => {
  it('grava a transição de presença e mantém o estado com duas conexões', async () => {
    const loginAna = await login(app.baseUrl, demoAccounts.ana, demoPassword);
    const first = connectSocket(app.baseUrl, '/agent', loginAna.token);
    const second = connectSocket(app.baseUrl, '/agent', loginAna.token);
    await Promise.all([waitConnect(first), waitConnect(second)]);
    const away = presenceAckSchema.parse(await emitAck(first, 'presence.set', { status: 'away' }));
    expect(away.ok).toBe(true);
    if (!away.ok) return;
    expect(away.status).toBe('away');
    first.disconnect();
    const still = presenceAckSchema.parse(await emitAck(second, 'presence.heartbeat', {}));
    expect(still.ok).toBe(true);
    if (!still.ok) return;
    expect(still.status).toBe('away');
    const back = presenceAckSchema.parse(await emitAck(second, 'presence.set', { status: 'available' }));
    expect(back.ok).toBe(true);
    const intervals = await withTenant(app.pool, demoIds.tenantA, (client) =>
      client.query<{ status: string; open: boolean }>(
        `SELECT status, ended_at IS NULL AS open
         FROM presence_intervals
         WHERE agent_id = $1
         ORDER BY started_at`,
        [demoIds.agentAna],
      ),
    );
    const open = intervals.rows.filter((row) => row.open);
    expect(open).toHaveLength(1);
    expect(open[0]?.status).toBe('available');
    expect(intervals.rows.some((row) => row.status === 'away' && !row.open)).toBe(true);
    second.disconnect();
  });

  it('aloca, consulta o histórico e recusa quem não tem permissão', async () => {
    const sofiaLogin = await login(app.baseUrl, demoAccounts.sofia, demoPassword);
    const anaLogin = await login(app.baseUrl, demoAccounts.ana, demoPassword);
    const dianaLogin = await login(app.baseUrl, demoAccounts.diana, demoPassword);
    const sofia = connectSocket(app.baseUrl, '/supervisor', sofiaLogin.token);
    const ana = connectSocket(app.baseUrl, '/agent', anaLogin.token);
    const diana = connectSocket(app.baseUrl, '/agent', dianaLogin.token);
    await Promise.all([waitConnect(sofia), waitConnect(ana), waitConnect(diana)]);
    const denied = activityAssignmentAckSchema.parse(
      await emitAck(ana, 'activity.assign', {
        agentId: demoIds.agentAna,
        activityTypeId: demoIds.activityServiceA,
      }),
    );
    expect(denied.ok).toBe(false);
    if (!denied.ok) expect(denied.error.code).toBe('forbidden');
    const assigned = activityAssignmentAckSchema.parse(
      await emitAck(sofia, 'activity.assign', {
        agentId: demoIds.agentAna,
        activityTypeId: demoIds.activityServiceA,
      }),
    );
    expect(assigned.ok).toBe(true);
    if (!assigned.ok) return;
    expect(assigned.assignment.activityName).toBe('Atendimento');
    expect(assigned.assignment.status).toBe('active');
    const own = activityAssignmentAckSchema.parse(
      await emitAck(diana, 'activity.assign', {
        agentId: demoIds.agentDiana,
        activityTypeId: demoIds.activityTrainingA,
      }),
    );
    expect(own.ok).toBe(true);
    const history = activityHistoryAckSchema.parse(
      await emitAck(ana, 'activity.history', { agentId: demoIds.agentAna }),
    );
    expect(history.ok).toBe(true);
    if (!history.ok) return;
    expect(history.assignments.some((item) => item.id === assigned.assignment.id)).toBe(true);
    const outsider = activityHistoryAckSchema.parse(
      await emitAck(diana, 'activity.history', { agentId: demoIds.agentAna }),
    );
    expect(outsider.ok).toBe(false);
    if (!outsider.ok) expect(outsider.error.code).toBe('forbidden');
    sofia.disconnect();
    ana.disconnect();
    diana.disconnect();
  });

  it('informa no perfil quem pode registrar a própria atividade', async () => {
    const expected = [
      [demoAccounts.ana, false],
      [demoAccounts.diana, true],
      [demoAccounts.sofia, true],
      [demoAccounts.otavio, true],
    ] as const;
    for (const [email, allowed] of expected) {
      const session = await login(app.baseUrl, email, demoPassword);
      const response = await fetch(`${app.baseUrl}/auth/me`, { headers: { authorization: `Bearer ${session.token}` } });
      expect(response.status).toBe(200);
      expect(authMeSchema.parse(await response.json()).canChangeOwnActivity).toBe(allowed);
    }
  });

  it('não deixa duas alocações ativas para o mesmo agente', async () => {
    const otavioLogin = await login(app.baseUrl, demoAccounts.otavio, demoPassword);
    const helenaLogin = await login(app.baseUrl, demoAccounts.helena, demoPassword);
    const otavio = connectSocket(app.baseUrl, '/supervisor', otavioLogin.token);
    const helena = connectSocket(app.baseUrl, '/supervisor', helenaLogin.token);
    await Promise.all([waitConnect(otavio), waitConnect(helena)]);
    await Promise.all([
      emitAck(otavio, 'activity.assign', {
        agentId: demoIds.agentDiana,
        activityTypeId: demoIds.activityServiceA,
      }),
      emitAck(helena, 'activity.assign', {
        agentId: demoIds.agentDiana,
        activityTypeId: demoIds.activityTrainingA,
      }),
    ]);
    const active = await withTenant(app.pool, demoIds.tenantA, (client) =>
      client.query(
        `SELECT id FROM activity_assignments
         WHERE agent_id = $1 AND ended_at IS NULL`,
        [demoIds.agentDiana],
      ),
    );
    expect(active.rows).toHaveLength(1);
    otavio.disconnect();
    helena.disconnect();
  });
});
