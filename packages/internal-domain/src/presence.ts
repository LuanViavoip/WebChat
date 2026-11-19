import type { IsoInstant } from './ids';
import type { UserId } from './identity';

export const PAUSE_REASONS = ['lanche', 'banheiro', 'treinamento', 'feedback', 'outro'] as const;
export type PauseReason = (typeof PAUSE_REASONS)[number];
export type PresenceStatus =
  | { readonly kind: 'available' }
  | { readonly kind: 'pause'; readonly reason: PauseReason; readonly since: IsoInstant }
  | { readonly kind: 'away'; readonly since: IsoInstant };
export type Presence = { readonly userId: UserId; readonly online: boolean; readonly lastSeenAt: IsoInstant | null; readonly status: PresenceStatus };
export type SetPresenceRequest = { readonly status: 'available' } | { readonly status: 'pause'; readonly reason: PauseReason } | { readonly status: 'away' };

export function becameAvailable(before: PresenceStatus, after: PresenceStatus): boolean {
  return before.kind !== 'available' && after.kind === 'available';
}
