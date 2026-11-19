import { localDateIn } from './day';
import type { IsoInstant } from './ids';
import type { UserId } from './identity';
import type { LocalDate } from './tenant';

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

function formatClock(instant: IsoInstant, timeZone: string): string {
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(instant));
}

function formatDay(instant: IsoInstant, timeZone: string): string {
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(new Date(instant));
}

function previousLocalDate(date: LocalDate): LocalDate {
  const [yearRaw, monthRaw, dayRaw] = date.split('-');
  const year = Number(yearRaw);
  const month = Number(monthRaw);
  const day = Number(dayRaw);
  const utc = new Date(Date.UTC(year, month - 1, day - 1));
  return utc.toISOString().slice(0, 10) as LocalDate;
}

function minutesBetween(from: IsoInstant, to: IsoInstant): number {
  const elapsed = Date.parse(to) - Date.parse(from);
  if (Number.isNaN(elapsed) || elapsed < 0) {
    return 0;
  }
  return Math.floor(elapsed / 60_000);
}

/** "online", "visto por último hoje às 14:32", "em pausa (lanche) há 5 min" — no fuso do tenant. */
export function presenceLabel(p: Presence, now: IsoInstant, timeZone: string): string {
  switch (p.status.kind) {
    case 'pause':
      return `em pausa (${p.status.reason}) há ${String(minutesBetween(p.status.since, now))} min`;
    case 'away':
      return `ausente há ${String(minutesBetween(p.status.since, now))} min`;
    case 'available':
      break;
    default: {
      const exhaustive: never = p.status;
      return exhaustive;
    }
  }
  if (p.online) {
    return 'online';
  }
  if (p.lastSeenAt === null) {
    return 'offline';
  }
  const clock = formatClock(p.lastSeenAt, timeZone);
  const seenDay = localDateIn(p.lastSeenAt, timeZone);
  const today = localDateIn(now, timeZone);
  if (seenDay === today) {
    return `visto por último hoje às ${clock}`;
  }
  if (seenDay === previousLocalDate(today)) {
    return `visto por último ontem às ${clock}`;
  }
  return `visto por último em ${formatDay(p.lastSeenAt, timeZone)} às ${clock}`;
}
