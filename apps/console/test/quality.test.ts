import type { QualityReport, QueueSummary, SectorSummary } from '@viavoip/protocol';
import { describe, expect, it } from 'vitest';
import { MAX_QUALITY_WINDOW_MS, isoToLocalInput, localInputToIso, presetPeriod, validatePeriod } from '../src/quality/period.js';
import { scopeOptions } from '../src/quality/scope.js';
import { coverageTotal, formatPercent, slaCompliance } from '../src/quality/summary.js';

const self = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaa01';
const other = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaa02';

function sector(id: string, name: string, supervisorIds: string[], active = true): SectorSummary {
  return {
    id,
    name,
    description: '',
    active,
    createdAt: '2026-10-01T00:00:00.000Z',
    canManage: true,
    members: [],
    supervisors: supervisorIds.map((agentId) => ({ agentId, name: agentId, role: 'supervisor' as const })),
  };
}

const queues: QueueSummary[] = [{ id: 'bbbbbbbb-2222-4222-8222-bbbbbbbbbb01', name: 'Suporte' }];
const sectors = [
  sector('cccccccc-3333-4333-8333-cccccccccc01', 'Suporte Técnico', [self]),
  sector('cccccccc-3333-4333-8333-cccccccccc02', 'Comercial', [other]),
  sector('cccccccc-3333-4333-8333-cccccccccc03', 'Antigo', [self], false),
];

describe('escopos do relatório de qualidade', () => {
  it('admin vê empresa, todos os setores ativos e filas', () => {
    const values = scopeOptions('admin', self, sectors, queues).map((option) => option.value);
    expect(values[0]).toBe('tenant');
    expect(values).toContain('sector:cccccccc-3333-4333-8333-cccccccccc01');
    expect(values).toContain('sector:cccccccc-3333-4333-8333-cccccccccc02');
    expect(values).not.toContain('sector:cccccccc-3333-4333-8333-cccccccccc03');
    expect(values).toContain('queue:bbbbbbbb-2222-4222-8222-bbbbbbbbbb01');
  });

  it('supervisor nunca recebe a empresa e só vê setores em que é responsável', () => {
    const options = scopeOptions('supervisor', self, sectors, queues);
    expect(options.some((option) => option.scope.kind === 'tenant')).toBe(false);
    expect(options.filter((option) => option.scope.kind === 'sector').map((option) => option.label)).toEqual(['Setor: Suporte Técnico']);
    expect(options.some((option) => option.scope.kind === 'queue')).toBe(true);
  });

  it('agente não tem escopo', () => {
    expect(scopeOptions('agent', self, sectors, queues)).toEqual([]);
  });
});

describe('período do relatório', () => {
  it('aceita até 31 dias e recusa mais que isso', () => {
    expect(validatePeriod('2026-10-01T00:00', '2026-10-31T23:00').ok).toBe(true);
    const tooLong = validatePeriod('2026-10-01T00:00', '2026-11-05T00:00');
    expect(tooLong).toEqual({ ok: false, message: 'O período máximo é de 31 dias.' });
  });

  it('recusa período vazio, invertido ou incompleto', () => {
    expect(validatePeriod('', '2026-10-31T23:00').ok).toBe(false);
    expect(validatePeriod('2026-10-02T00:00', '2026-10-01T00:00').ok).toBe(false);
    expect(validatePeriod('2026-10-01T00:00', '2026-10-01T00:00').ok).toBe(false);
  });

  it('converte entre o campo local e ISO sem perder o instante', () => {
    const iso = localInputToIso('2026-10-10T10:30');
    expect(iso).not.toBeNull();
    expect(isoToLocalInput(iso ?? '')).toBe('2026-10-10T10:30');
    expect(localInputToIso('')).toBeNull();
  });

  it('presets nunca passam do limite', () => {
    const now = Date.UTC(2026, 9, 29, 12);
    const { from, to } = presetPeriod(now, 90);
    const span = (localInputToIso(to) ? Date.parse(localInputToIso(to) ?? '') : 0) - Date.parse(localInputToIso(from) ?? '');
    expect(span).toBeLessThanOrEqual(MAX_QUALITY_WINDOW_MS);
  });
});

describe('resumo do relatório', () => {
  const tally = { within: 8, breached: 2, notApplicable: 5 };

  it('calcula o percentual só entre casos aplicáveis', () => {
    expect(slaCompliance(tally)).toBe(80);
    expect(slaCompliance({ within: 0, breached: 0, notApplicable: 3 })).toBeNull();
    expect(formatPercent(80)).toBe('80%');
    expect(formatPercent(null)).toBe('—');
  });

  it('soma a cobertura de primeira resposta', () => {
    const coverage: QualityReport['firstResponseCoverage'] = { answered: 5, unansweredClosed: 1, transferredUnanswered: 1, stillOpen: 2, unreadable: 0 };
    expect(coverageTotal(coverage)).toBe(9);
  });
});
