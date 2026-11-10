import { formatDateSeparator, formatTime, isSameCalendarDay } from './dates';

describe('dates', () => {
  it('usa Hoje e Ontem no separador', () => {
    const now = new Date('2026-11-10T15:00:00');
    expect(formatDateSeparator('2026-11-10T08:00:00', now)).toBe('Hoje');
    expect(formatDateSeparator('2026-11-09T22:00:00', now)).toBe('Ontem');
  });

  it('formata hora em pt-BR', () => {
    expect(formatTime('2026-11-10T08:05:00')).toMatch(/\d{2}:\d{2}/);
  });

  it('compara o mesmo dia civil', () => {
    expect(isSameCalendarDay('2026-11-10T01:00:00', '2026-11-10T23:00:00')).toBe(true);
    expect(isSameCalendarDay('2026-11-10T23:00:00', '2026-11-11T00:00:00')).toBe(false);
  });
});
