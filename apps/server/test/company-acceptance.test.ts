import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { resolveAcceptance } from '../src/domain/acceptance.js';
import { withTenant } from '../src/db/tenant.js';
import { demoIds, demoSites } from '../src/demo/ids.js';
import { conversationSnapshotAckSchema } from '@viavoip/protocol';
import { emitAck, openVisitor, startTestApp, type TestApp } from './helpers.js';

let app: TestApp;

beforeAll(async () => {
  app = await startTestApp();
});

afterAll(async () => {
  await app.app.close();
});

const mondayWindow = { kind: 'weekly' as const, windows: [{ weekday: 1, startMinute: 540, endMinute: 720 }] };

describe('aceitação efetiva', () => {
  it('respeita o exemplo de quarta-feira em São Paulo e a segunda às 10:00', () => {
    expect(
      resolveAcceptance({ kind: 'accepting' }, mondayWindow, 'America/Sao_Paulo', '2026-10-28T15:00:00.000Z'),
    ).toEqual({ kind: 'outside_service_window', resumesAt: '2026-11-02T12:00:00.000Z' });
    expect(
      resolveAcceptance({ kind: 'accepting' }, mondayWindow, 'America/Sao_Paulo', '2026-10-26T13:00:00.000Z'),
    ).toEqual({ kind: 'accepting' });
    expect(
      resolveAcceptance(
        { kind: 'paused', reason: 'pausa' },
        mondayWindow,
        'America/Sao_Paulo',
        '2026-10-26T13:00:00.000Z',
      ),
    ).toEqual({ kind: 'paused', reason: 'pausa' });
    expect(
      resolveAcceptance({ kind: 'accepting' }, { kind: 'always_open' }, 'America/Sao_Paulo', '2026-10-28T15:00:00.000Z'),
    ).toEqual({ kind: 'accepting' });
  });

  it('usa o offset do instante no horário de verão de Nova York', () => {
    const office = { kind: 'weekly' as const, windows: [{ weekday: 7, startMinute: 540, endMinute: 1020 }] };
    expect(resolveAcceptance({ kind: 'accepting' }, office, 'America/New_York', '2026-01-11T13:30:00.000Z').kind).toBe(
      'outside_service_window',
    );
    expect(resolveAcceptance({ kind: 'accepting' }, office, 'America/New_York', '2026-03-08T13:30:00.000Z').kind).toBe(
      'accepting',
    );
  });

  it('recusa abrir conversa fora da janela e durante a pausa', async () => {
    await withTenant(app.pool, demoIds.tenantA, (client) =>
      client.query(
        `INSERT INTO site_service_windows (site_id, tenant_id, weekday, start_minute, end_minute)
         VALUES ($1, $2, 1, 540, 720)`,
        [demoIds.siteA, demoIds.tenantA],
      ),
    );
    try {
      const visitor = await openVisitor(app.baseUrl, demoSites.a);
      const closed = conversationSnapshotAckSchema.parse(
        await emitAck(visitor.socket, 'conversation.start', { queueId: demoIds.queueSupportA }),
      );
      expect(closed.ok).toBe(false);
      visitor.socket.disconnect();
    } finally {
      await withTenant(app.pool, demoIds.tenantA, (client) =>
        client.query(`DELETE FROM site_service_windows WHERE site_id = $1`, [demoIds.siteA]),
      );
    }
  });
});
