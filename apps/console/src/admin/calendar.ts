import type { ServiceCalendar, ServiceWindow } from '@viavoip/protocol';

export const weekdayLabels: Record<number, string> = {
  1: 'Segunda',
  2: 'Terça',
  3: 'Quarta',
  4: 'Quinta',
  5: 'Sexta',
  6: 'Sábado',
  7: 'Domingo',
};

/** 0..1440 para "HH:MM". 1440 vira "24:00" (fim do dia). */
export function minutesToTime(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return `${String(hours).padStart(2, '0')}:${String(rest).padStart(2, '0')}`;
}

/** "HH:MM" para minutos. `fim` aceita "00:00" como meia-noite (1440). `null` se inválido. */
export function timeToMinutes(value: string, edge: 'inicio' | 'fim'): number | null {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const minutes = Number(match[1]) * 60 + Number(match[2]);
  if (minutes === 0 && edge === 'fim') return 1440;
  return minutes;
}

export function describeCalendar(calendar: ServiceCalendar): string {
  if (calendar.kind === 'always_open') return 'Sempre aberto';
  const days = [...new Set(calendar.windows.map((window) => window.weekday))].sort((a, b) => a - b);
  return `${calendar.windows.length} janela(s) em ${days.map((day) => (weekdayLabels[day] ?? String(day)).slice(0, 3)).join(', ')}`;
}

export function sortWindows(windows: ServiceWindow[]): ServiceWindow[] {
  return [...windows].sort((a, b) => a.weekday - b.weekday || a.startMinute - b.startMinute);
}
