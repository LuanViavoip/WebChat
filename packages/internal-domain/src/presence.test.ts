import { describe, expect, it } from 'vitest';
import { asIsoInstant } from './ids';
import { becameAvailable, presenceLabel, type Presence, type PresenceStatus } from './presence';
import { uid } from './testing/domainFixtures';

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

describe('presenceLabel', () => {
  const tz = 'America/Sao_Paulo';
  const now = asIsoInstant('2026-11-19T17:00:00.000Z');
  const userId = uid('ag-1');

  function presence(over: Partial<Presence>): Presence {
    return {
      userId,
      online: false,
      lastSeenAt: null,
      status: { kind: 'available' },
      ...over,
    };
  }

  it.each([
    ['online disponível', presence({ online: true }), 'online'],
    [
      'pausa com motivo e duração',
      presence({ status: { kind: 'pause', reason: 'lanche', since: asIsoInstant('2026-11-19T16:55:00.000Z') } }),
      'em pausa (lanche) há 5 min',
    ],
    [
      'ausente com duração',
      presence({ status: { kind: 'away', since: asIsoInstant('2026-11-19T16:50:00.000Z') } }),
      'ausente há 10 min',
    ],
    [
      'visto por último hoje no fuso da empresa',
      presence({ lastSeenAt: asIsoInstant('2026-11-19T16:32:00.000Z') }),
      'visto por último hoje às 13:32',
    ],
    [
      'visto por último ontem',
      presence({ lastSeenAt: asIsoInstant('2026-11-18T16:32:00.000Z') }),
      'visto por último ontem às 13:32',
    ],
    [
      'visto por último em outro dia',
      presence({ lastSeenAt: asIsoInstant('2026-11-10T16:32:00.000Z') }),
      'visto por último em 10/11/2026 às 13:32',
    ],
    ['offline sem lastSeen', presence({}), 'offline'],
  ])('%s', (_label, value, expected) => {
    expect(presenceLabel(value, now, tz)).toBe(expected);
  });
});
