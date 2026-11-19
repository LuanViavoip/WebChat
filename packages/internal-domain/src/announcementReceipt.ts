import type { AnnouncementId, IsoInstant, RevisionNo } from './ids';
import type { IlhaId, UserId } from './identity';
import { err, ok, type Result } from './result';

export type ReceiptState =
  | { readonly phase: 'unseen' }
  | { readonly phase: 'viewed'; readonly viewedAt: IsoInstant; readonly maxPositionMs: number }
  | { readonly phase: 'played'; readonly viewedAt: IsoInstant; readonly playedAt: IsoInstant }
  | {
      readonly phase: 'acknowledged';
      readonly viewedAt: IsoInstant;
      readonly playedAt: IsoInstant | null;
      readonly acknowledgedAt: IsoInstant;
    };

export type AnnouncementRevisionRef = { readonly id: AnnouncementId; readonly revision: RevisionNo };

export type PlaybackReport = AnnouncementRevisionRef & {
  readonly maxPositionMs: number;
  readonly durationMs: number;
  readonly ended: boolean;
};

export type ReceiptEvent =
  | { readonly type: 'viewed'; readonly at: IsoInstant }
  | {
      readonly type: 'playback';
      readonly at: IsoInstant;
      readonly maxPositionMs: number;
      readonly durationMs: number;
      readonly ended: boolean;
    }
  | { readonly type: 'acknowledged'; readonly at: IsoInstant };

export type AckDenial = 'not-in-audience' | 'expired' | 'stale-revision' | 'playback-required' | 'not-viewed';

/** Pura e idempotente. 'played' exige ended e maxPositionMs ≥ 95% de durationMs. A posição só cresce. */
export function nextReceipt(
  s: ReceiptState,
  e: ReceiptEvent,
  rule: { readonly requireFullPlayback: boolean },
): Result<ReceiptState, AckDenial> {
  switch (e.type) {
    case 'viewed': {
      if (s.phase === 'unseen') {
        return ok({ phase: 'viewed', viewedAt: e.at, maxPositionMs: 0 });
      }
      return ok(s);
    }
    case 'playback': {
      if (s.phase === 'played' || s.phase === 'acknowledged') {
        return ok(s);
      }
      const viewedAt = s.phase === 'unseen' ? e.at : s.viewedAt;
      const prevMax = s.phase === 'viewed' ? s.maxPositionMs : 0;
      const reported = Number.isFinite(e.maxPositionMs) ? Math.max(0, e.maxPositionMs) : 0;
      const maxPositionMs = Math.max(prevMax, reported);
      if (e.ended && e.durationMs > 0 && maxPositionMs * 100 >= e.durationMs * 95) {
        return ok({ phase: 'played', viewedAt, playedAt: e.at });
      }
      if (s.phase === 'viewed' && maxPositionMs === s.maxPositionMs) {
        return ok(s);
      }
      return ok({ phase: 'viewed', viewedAt, maxPositionMs });
    }
    case 'acknowledged': {
      if (s.phase === 'acknowledged') {
        return ok(s);
      }
      if (rule.requireFullPlayback) {
        if (s.phase !== 'played') {
          return err('playback-required');
        }
        return ok({
          phase: 'acknowledged',
          viewedAt: s.viewedAt,
          playedAt: s.playedAt,
          acknowledgedAt: e.at,
        });
      }
      if (s.phase === 'unseen') {
        return err('not-viewed');
      }
      if (s.phase === 'viewed') {
        return ok({
          phase: 'acknowledged',
          viewedAt: s.viewedAt,
          playedAt: null,
          acknowledgedAt: e.at,
        });
      }
      return ok({
        phase: 'acknowledged',
        viewedAt: s.viewedAt,
        playedAt: s.playedAt,
        acknowledgedAt: e.at,
      });
    }
  }
}

export type ReceiptTally = {
  readonly revision: RevisionNo;
  readonly viewed: readonly { readonly userId: UserId; readonly at: IsoInstant }[];
  readonly played: readonly { readonly userId: UserId; readonly at: IsoInstant }[];
  readonly acknowledged: readonly { readonly userId: UserId; readonly at: IsoInstant }[];
  readonly pending: readonly UserId[];
  readonly lastReminderAt: IsoInstant | null;
};

export type ReceiptsPanel = ReceiptTally & {
  readonly byIlha: readonly { readonly ilhaId: IlhaId; readonly acknowledged: number; readonly total: number }[];
  readonly history: readonly ReceiptTally[];
};
