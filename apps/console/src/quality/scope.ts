import type { QualityScope, QueueSummary, Role, SectorSummary } from '@viavoip/protocol';

/**
 * O servidor aceita relatório de qualidade para: admin em qualquer escopo (empresa, setor, fila);
 * supervisor apenas em setores onde é responsável e em filas sob sua supervisão (nunca a empresa).
 * Espelha `assertSupervisorQualityScope` em apps/server/src/domain/company-access.ts.
 */
export type ScopeOption = { value: string; label: string; scope: QualityScope };

export function scopeOptions(
  role: Role,
  selfId: string,
  sectors: SectorSummary[],
  queues: QueueSummary[],
): ScopeOption[] {
  if (role === 'agent') return [];
  const options: ScopeOption[] = [];
  if (role === 'admin') options.push({ value: 'tenant', label: 'Toda a empresa', scope: { kind: 'tenant' } });
  for (const sector of sectors) {
    if (!sector.active) continue;
    if (role === 'supervisor' && !sector.supervisors.some((person) => person.agentId === selfId)) continue;
    options.push({ value: `sector:${sector.id}`, label: `Setor: ${sector.name}`, scope: { kind: 'sector', sectorId: sector.id } });
  }
  for (const queue of queues) {
    options.push({ value: `queue:${queue.id}`, label: `Fila: ${queue.name}`, scope: { kind: 'queue', queueId: queue.id } });
  }
  return options;
}
