import type { LocalDate } from './tenant';

/** Data local ('YYYY-MM-DD') de um instante ISO no fuso horário da empresa. */
export function localDateIn(instant: string, timeZone: string): LocalDate {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(instant)) as LocalDate;
}

export function isFirstLoginOfDay(last: LocalDate | null, today: LocalDate): boolean {
  return last === null || last !== today;
}
