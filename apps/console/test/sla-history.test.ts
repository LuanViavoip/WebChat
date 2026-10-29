import type { SlaPolicyView } from '@viavoip/protocol';
import { describe, expect, it } from 'vitest';
import { slaVersions } from '../src/admin/sla-history.js';

const queueId = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaa2';
const otherQueueId = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaa3';
const now = Date.parse('2026-10-29T12:00:00.000Z');

function policy(id: string, queue: string, wait: number, life: SlaPolicyView['life']): SlaPolicyView {
  return {
    id,
    queueId: queue,
    queueWait: { metric: 'queue_wait', thresholdSeconds: wait },
    firstResponse: { metric: 'first_response', thresholdSeconds: wait * 2 },
    life,
  };
}

describe('histórico de versões do SLA', () => {
  it('numera da mais antiga para a mais nova e lista a mais recente primeiro', () => {
    const versions = slaVersions(
      [
        policy('c', queueId, 60, { status: 'active', effectiveFrom: '2026-10-29T10:00:00.000Z' }),
        policy('a', queueId, 180, { status: 'retired', effectiveFrom: '2026-10-01T10:00:00.000Z', retiredAt: '2026-10-15T10:00:00.000Z' }),
        policy('b', queueId, 120, { status: 'retired', effectiveFrom: '2026-10-15T10:00:00.000Z', retiredAt: '2026-10-29T10:00:00.000Z' }),
        policy('x', otherQueueId, 30, { status: 'active', effectiveFrom: '2026-10-01T10:00:00.000Z' }),
      ],
      queueId,
      now,
    );
    expect(versions.map((item) => [item.id, item.number, item.state])).toEqual([
      ['c', 3, 'current'],
      ['b', 2, 'retired'],
      ['a', 1, 'retired'],
    ]);
    expect(versions[0]?.retiredAt).toBeNull();
    expect(versions[1]?.retiredAt).toBe('2026-10-29T10:00:00.000Z');
    expect(versions[2]?.queueWaitSeconds).toBe(180);
  });

  it('distingue versão agendada e versão cujo fim ainda não chegou', () => {
    const versions = slaVersions(
      [
        policy('old', queueId, 120, { status: 'retired', effectiveFrom: '2026-10-01T10:00:00.000Z', retiredAt: '2026-10-29T18:00:00.000Z' }),
        policy('next', queueId, 60, { status: 'active', effectiveFrom: '2026-10-29T18:00:00.000Z' }),
      ],
      queueId,
      now,
    );
    expect(versions.map((item) => item.state)).toEqual(['scheduled', 'ending']);
  });

  it('devolve lista vazia para fila sem SLA', () => {
    expect(slaVersions([], queueId, now)).toEqual([]);
  });
});
