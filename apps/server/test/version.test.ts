import { afterEach, describe, expect, it, vi } from 'vitest';
import { startTestApp, type TestApp } from './helpers.js';

let app: TestApp | undefined;

afterEach(async () => {
  vi.unstubAllEnvs();
  await app?.app.close();
  app = undefined;
});

async function readVersion(): Promise<{ status: number; body: unknown }> {
  const response = await fetch(`${app!.baseUrl}/version`);
  return { status: response.status, body: await response.json() };
}

describe('GET /version', () => {
  it('devolve unknown sem GIT_SHA e BUILT_AT, sem exigir sessão', async () => {
    vi.stubEnv('GIT_SHA', '');
    vi.stubEnv('BUILT_AT', '');
    app = await startTestApp();
    expect(await readVersion()).toEqual({ status: 200, body: { sha: 'unknown', builtAt: 'unknown' } });
  });

  it('devolve sha e builtAt das variáveis de ambiente', async () => {
    vi.stubEnv('GIT_SHA', 'abc1234def5678');
    vi.stubEnv('BUILT_AT', '2026-11-16T12:00:00Z');
    app = await startTestApp();
    expect(await readVersion()).toEqual({
      status: 200,
      body: { sha: 'abc1234def5678', builtAt: '2026-11-16T12:00:00Z' },
    });
  });
});
