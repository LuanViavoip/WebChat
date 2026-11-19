import { describe, expect, it } from 'vitest';
import {
  nextReceipt,
  type ReceiptEvent,
  type ReceiptState,
} from './announcementReceipt';
import { asIsoInstant } from './ids';
import { err, ok } from './result';

const T1 = asIsoInstant('2026-11-19T12:00:00.000Z');
const T2 = asIsoInstant('2026-11-19T12:01:00.000Z');
const T3 = asIsoInstant('2026-11-19T12:02:00.000Z');

const UNSEEN: ReceiptState = { phase: 'unseen' };
const VIEWED_0: ReceiptState = { phase: 'viewed', viewedAt: T1, maxPositionMs: 0 };
const VIEWED_5000: ReceiptState = { phase: 'viewed', viewedAt: T1, maxPositionMs: 5000 };
const PLAYED: ReceiptState = { phase: 'played', viewedAt: T1, playedAt: T2 };
const ACK_NO_PLAY: ReceiptState = { phase: 'acknowledged', viewedAt: T1, playedAt: null, acknowledgedAt: T2 };
const ACK_PLAYED: ReceiptState = { phase: 'acknowledged', viewedAt: T1, playedAt: T2, acknowledgedAt: T3 };

describe('nextReceipt', () => {
  it.each<
    [
      string,
      ReceiptState,
      ReceiptEvent,
      { requireFullPlayback: boolean },
      ReturnType<typeof nextReceipt>,
    ]
  >([
    ['unseen + viewed -> viewed', UNSEEN, { type: 'viewed', at: T1 }, { requireFullPlayback: false }, ok(VIEWED_0)],
    ['viewed + viewed é idempotente', VIEWED_5000, { type: 'viewed', at: T2 }, { requireFullPlayback: false }, ok(VIEWED_5000)],
    ['played + viewed é idempotente', PLAYED, { type: 'viewed', at: T3 }, { requireFullPlayback: true }, ok(PLAYED)],
    [
      'acknowledged + viewed é idempotente',
      ACK_NO_PLAY,
      { type: 'viewed', at: T3 },
      { requireFullPlayback: false },
      ok(ACK_NO_PLAY),
    ],
    [
      'playback sem ended só avança maxPositionMs',
      VIEWED_0,
      { type: 'playback', at: T2, maxPositionMs: 5000, durationMs: 10_000, ended: false },
      { requireFullPlayback: true },
      ok(VIEWED_5000),
    ],
    [
      'playback com posição menor não retrocede maxPositionMs',
      VIEWED_5000,
      { type: 'playback', at: T2, maxPositionMs: 2000, durationMs: 10_000, ended: false },
      { requireFullPlayback: true },
      ok(VIEWED_5000),
    ],
    [
      'playback com ended antes de 95% não conclui played',
      VIEWED_5000,
      { type: 'playback', at: T2, maxPositionMs: 9499, durationMs: 10_000, ended: true },
      { requireFullPlayback: true },
      ok({ phase: 'viewed', viewedAt: T1, maxPositionMs: 9499 }),
    ],
    [
      'playback com ended e >= 95% conclui played',
      VIEWED_5000,
      { type: 'playback', at: T2, maxPositionMs: 9500, durationMs: 10_000, ended: true },
      { requireFullPlayback: true },
      ok(PLAYED),
    ],
    [
      'playback após played é idempotente',
      PLAYED,
      { type: 'playback', at: T3, maxPositionMs: 1000, durationMs: 10_000, ended: false },
      { requireFullPlayback: true },
      ok(PLAYED),
    ],
    [
      'acknowledged sem viewed retorna not-viewed quando mídia não é obrigatória',
      UNSEEN,
      { type: 'acknowledged', at: T2 },
      { requireFullPlayback: false },
      err('not-viewed'),
    ],
    [
      'acknowledged em viewed aceita quando não exige reprodução',
      VIEWED_0,
      { type: 'acknowledged', at: T2 },
      { requireFullPlayback: false },
      ok(ACK_NO_PLAY),
    ],
    [
      'acknowledged em unseen exige reprodução quando requireFullPlayback=true',
      UNSEEN,
      { type: 'acknowledged', at: T2 },
      { requireFullPlayback: true },
      err('playback-required'),
    ],
    [
      'acknowledged em viewed exige reprodução quando requireFullPlayback=true',
      VIEWED_5000,
      { type: 'acknowledged', at: T3 },
      { requireFullPlayback: true },
      err('playback-required'),
    ],
    [
      'acknowledged em played conclui quando requireFullPlayback=true',
      PLAYED,
      { type: 'acknowledged', at: T3 },
      { requireFullPlayback: true },
      ok(ACK_PLAYED),
    ],
    [
      'acknowledged repetido é idempotente',
      ACK_PLAYED,
      { type: 'acknowledged', at: asIsoInstant('2026-11-19T12:05:00.000Z') },
      { requireFullPlayback: true },
      ok(ACK_PLAYED),
    ],
  ])('%s', (_label, state, event, rule, expected) => {
    expect(nextReceipt(state, event, rule)).toEqual(expected);
  });
});
