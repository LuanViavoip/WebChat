import type { QualityReport } from '@viavoip/protocol';

type Tally = QualityReport['sla']['queueWait'];

/** Percentual cumprido entre os casos aplicáveis; `null` quando não há nenhum. */
export function slaCompliance(tally: Tally): number | null {
  const applicable = tally.within + tally.breached;
  if (applicable === 0) return null;
  return Math.round((tally.within / applicable) * 1000) / 10;
}

export function formatPercent(value: number | null): string {
  if (value === null) return '—';
  return `${value.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`;
}

/** Total de primeiras respostas consideradas na cobertura. */
export function coverageTotal(coverage: QualityReport['firstResponseCoverage']): number {
  return coverage.answered + coverage.unansweredClosed + coverage.transferredUnanswered + coverage.stillOpen + coverage.unreadable;
}
