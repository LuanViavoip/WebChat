/**
 * Janela máxima do relatório. O valor vem de `MAX_QUALITY_WINDOW_MS` em packages/protocol/src/company.ts,
 * que não é exportado pelo pacote; o servidor rejeita períodos maiores.
 */
export const MAX_QUALITY_WINDOW_MS = 31 * 24 * 60 * 60 * 1000;

export type PeriodResult = { ok: true; from: string; to: string } | { ok: false; message: string };

/** Converte `YYYY-MM-DDTHH:mm` (campo datetime-local, fuso local) em ISO. `null` se inválido. */
export function localInputToIso(value: string): string | null {
  if (!value) return null;
  const time = new Date(value).getTime();
  return Number.isNaN(time) ? null : new Date(time).toISOString();
}

/** ISO para o valor de um campo datetime-local no fuso local. */
export function isoToLocalInput(iso: string): string {
  const date = new Date(iso);
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().slice(0, 16);
}

export function validatePeriod(fromInput: string, toInput: string): PeriodResult {
  const from = localInputToIso(fromInput);
  const to = localInputToIso(toInput);
  if (!from || !to) return { ok: false, message: 'Informe as datas inicial e final.' };
  const span = Date.parse(to) - Date.parse(from);
  if (span <= 0) return { ok: false, message: 'A data inicial deve ser anterior à final.' };
  if (span > MAX_QUALITY_WINDOW_MS) return { ok: false, message: 'O período máximo é de 31 dias.' };
  return { ok: true, from, to };
}

/** Período terminando em `now`, com `days` dias de duração (limitado a 31). */
export function presetPeriod(now: number, days: number): { from: string; to: string } {
  const span = Math.min(days * 24 * 60 * 60 * 1000, MAX_QUALITY_WINDOW_MS);
  return { from: isoToLocalInput(new Date(now - span).toISOString()), to: isoToLocalInput(new Date(now).toISOString()) };
}
