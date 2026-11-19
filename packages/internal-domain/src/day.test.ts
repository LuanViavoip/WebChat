import { describe, expect, it } from 'vitest';
import { isFirstLoginOfDay, localDateIn } from './day';
import type { LocalDate } from './tenant';

describe('localDateIn', () => {
  it.each([
    ['antes da meia-noite em São Paulo (UTC-3)', '2026-11-19T02:59:59.000Z', 'America/Sao_Paulo', '2026-11-18'],
    ['após meia-noite em São Paulo (UTC-3)', '2026-11-19T03:00:00.000Z', 'America/Sao_Paulo', '2026-11-19'],
    ['mesmo instante ainda é dia anterior em Manaus (UTC-4)', '2026-11-19T03:30:00.000Z', 'America/Manaus', '2026-11-18'],
  ])('%s', (_label, instant, timeZone, expected) => {
    expect(localDateIn(instant, timeZone)).toBe(expected);
  });
});

describe('isFirstLoginOfDay', () => {
  const nov18 = '2026-11-18' as LocalDate;
  const nov19 = '2026-11-19' as LocalDate;

  it.each([
    ['primeiro login da conta (last=null)', null, nov19, true],
    ['login no dia seguinte', nov18, nov19, true],
    ['segundo login no mesmo dia', nov19, nov19, false],
  ])('%s', (_label, last, today, expected) => {
    expect(isFirstLoginOfDay(last, today)).toBe(expected);
  });
});
