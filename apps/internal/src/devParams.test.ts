import { describe, expect, it } from 'vitest';
import { createClockFromSearch, parseNowParam } from './devParams';

describe('devParams (?agora=)', () => {
  it('faz parse de ?agora= ISO válido e normaliza para UTC ISO-8601', () => {
    expect(parseNowParam('?como=ics-ana&agora=2026-11-19T12:30:00.000Z')).toBe('2026-11-19T12:30:00.000Z');
    expect(parseNowParam('agora=2026-11-19T09:30:00-03:00')).toBe('2026-11-19T12:30:00.000Z');
  });

  it('devolve null quando ?agora= está ausente, vazio ou inválido', () => {
    expect(parseNowParam('')).toBeNull();
    expect(parseNowParam('?como=ics-ana')).toBeNull();
    expect(parseNowParam('?agora=')).toBeNull();
    expect(parseNowParam('?agora=nao-e-data')).toBeNull();
  });

  it('createClockFromSearch fixa o relógio quando ?agora= é válido e usa relógio real caso contrário', () => {
    const fixedClock = createClockFromSearch('?agora=2026-11-20T08:00:00.000Z');
    expect(fixedClock()).toBe('2026-11-20T08:00:00.000Z');

    const liveClock = createClockFromSearch('');
    expect(Number.isNaN(Date.parse(liveClock()))).toBe(false);
  });
});
