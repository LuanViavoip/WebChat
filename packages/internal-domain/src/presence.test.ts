import { describe, expect, it } from 'vitest';
import { asIsoInstant } from './ids';
import { becameAvailable, type PresenceStatus } from './presence';

describe('becameAvailable', () => {
  const since = asIsoInstant('2026-11-19T12:00:00.000Z');
  const available: PresenceStatus = { kind: 'available' };
  const away: PresenceStatus = { kind: 'away', since };
  const pause: PresenceStatus = { kind: 'pause', reason: 'lanche', since };

  it.each([
    ['ausente -> disponível', away, available, true],
    ['pausa -> disponível', pause, available, true],
    ['disponível -> disponível', available, available, false],
    ['disponível -> ausente', available, away, false],
    ['disponível -> pausa', available, pause, false],
    ['pausa -> ausente', pause, away, false],
    ['ausente -> pausa', away, pause, false],
  ])('%s', (_label, before, after, expected) => {
    expect(becameAvailable(before, after)).toBe(expected);
  });
});
