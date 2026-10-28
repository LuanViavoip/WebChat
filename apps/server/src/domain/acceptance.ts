import type { ConfiguredAcceptance, EffectiveAcceptance, ServiceCalendar, ServiceWindow } from '@viavoip/protocol';

const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

export function resolveAcceptance(
  acceptance: ConfiguredAcceptance,
  calendar: ServiceCalendar,
  timeZone: string,
  nowIso: string,
): EffectiveAcceptance {
  if (acceptance.kind === 'paused') return acceptance;
  if (calendar.kind === 'always_open') return { kind: 'accepting' };
  const now = new Date(nowIso);
  const local = localParts(timeZone, now);
  const openNow = calendar.windows.some(
    (window) => window.weekday === local.weekday && local.minute >= window.startMinute && local.minute < window.endMinute,
  );
  if (openNow) return { kind: 'accepting' };
  return { kind: 'outside_service_window', resumesAt: nextOpening(timeZone, now, calendar.windows).toISOString() };
}

function localParts(timeZone: string, instant: Date): { weekday: number; minute: number; year: number; month: number; day: number } {
  const parts = partsOf(timeZone, instant);
  const weekdayName = parts.weekday ?? 'Sun';
  const sundayIndex = weekdays.indexOf(weekdayName as (typeof weekdays)[number]);
  const weekday = sundayIndex === 0 ? 7 : sundayIndex;
  const hour = parts.hour === '24' ? 0 : Number(parts.hour);
  return {
    weekday,
    minute: hour * 60 + Number(parts.minute),
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
  };
}

function nextOpening(timeZone: string, now: Date, windows: readonly ServiceWindow[]): Date {
  const local = localParts(timeZone, now);
  let best: Date | null = null;
  for (let offset = 0; offset < 8; offset += 1) {
    const day = addDays(local.year, local.month, local.day, offset);
    const weekday = ((local.weekday - 1 + offset) % 7) + 1;
    for (const window of windows) {
      if (window.weekday !== weekday) continue;
      const opening = utcFromLocal(timeZone, day.year, day.month, day.day, window.startMinute);
      if (opening.getTime() <= now.getTime()) continue;
      if (!best || opening.getTime() < best.getTime()) best = opening;
    }
  }
  if (!best) throw new Error('Calendário sem próxima abertura');
  return best;
}

function partsOf(timeZone: string, instant: Date): Record<string, string> {
  const formatted = new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(instant);
  return Object.fromEntries(formatted.map((part) => [part.type, part.value]));
}

function addDays(year: number, month: number, day: number, offset: number): { year: number; month: number; day: number } {
  const date = new Date(Date.UTC(year, month - 1, day + offset));
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() };
}

function utcFromLocal(timeZone: string, year: number, month: number, day: number, minuteOfDay: number): Date {
  const hour = Math.floor(minuteOfDay / 60);
  const minute = minuteOfDay % 60;
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  const seen = partsOf(timeZone, new Date(guess));
  const seenHour = seen.hour === '24' ? 0 : Number(seen.hour);
  const asUtc = Date.UTC(Number(seen.year), Number(seen.month) - 1, Number(seen.day), seenHour, Number(seen.minute));
  return new Date(guess - (asUtc - guess));
}
