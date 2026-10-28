import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { companyCommandResultSchema, companyDeskSchema } from '@viavoip/protocol';
import { demoAccounts, demoPassword } from '../src/demo/ids.js';
import { login, postJson, startTestApp, type TestApp } from './helpers.js';

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
