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

  it('marca a próxima abertura no offset daquele instante, inclusive no vão da virada', () => {
    const afterSpring = { kind: 'weekly' as const, windows: [{ weekday: 7, startMinute: 210, endMinute: 720 }] };
    // 2026-03-08T06:00:00Z é 01:00 EST. 03:30 local só existe em EDT, às 07:30Z.
    expect(resolveAcceptance({ kind: 'accepting' }, afterSpring, 'America/New_York', '2026-03-08T06:00:00.000Z')).toEqual({
      kind: 'outside_service_window',
      resumesAt: '2026-03-08T07:30:00.000Z',
    });
    // 02:30 não existe nesse domingo: o relógio salta de 02:00 EST para 03:00 EDT (07:00Z).
    const gap = { kind: 'weekly' as const, windows: [{ weekday: 7, startMinute: 150, endMinute: 720 }] };
    expect(resolveAcceptance({ kind: 'accepting' }, gap, 'America/New_York', '2026-03-08T06:00:00.000Z')).toEqual({
      kind: 'outside_service_window',
      resumesAt: '2026-03-08T07:00:00.000Z',
    });
    // 2026-11-01T05:30:00Z é 01:30 EDT. 02:30 local, depois do retorno, é 07:30Z.
    const afterFall = { kind: 'weekly' as const, windows: [{ weekday: 7, startMinute: 150, endMinute: 240 }] };
    expect(resolveAcceptance({ kind: 'accepting' }, afterFall, 'America/New_York', '2026-11-01T05:30:00.000Z')).toEqual({
      kind: 'outside_service_window',
      resumesAt: '2026-11-01T07:30:00.000Z',
    });
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
