import type { SlaPolicyView } from '@viavoip/protocol';

export type SlaVersionState = 'current' | 'scheduled' | 'ending' | 'retired';

export type SlaVersion = {
  id: string;
  /** Número da versão na fila, contado da mais antiga (1) para a mais recente. */
  number: number;
  queueWaitSeconds: number;
  firstResponseSeconds: number;
  effectiveFrom: string;
  retiredAt: string | null;
  state: SlaVersionState;
};

/**
 * Histórico das versões de SLA de uma fila, da mais recente para a mais antiga.
 * A mesa da empresa já devolve as versões vigentes e as retiradas; aqui só se numera e se classifica
 * cada uma em relação ao instante `now` (uma versão retirada com fim futuro ainda está valendo).
 */
export function slaVersions(policies: SlaPolicyView[], queueId: string, now: number): SlaVersion[] {
  return policies
    .filter((policy) => policy.queueId === queueId)
    .sort((left, right) => Date.parse(left.life.effectiveFrom) - Date.parse(right.life.effectiveFrom))
    .map((policy, index): SlaVersion => {
      const effective = Date.parse(policy.life.effectiveFrom);
      if (policy.life.status === 'active') {
        return {
          id: policy.id,
          number: index + 1,
          queueWaitSeconds: policy.queueWait.thresholdSeconds,
          firstResponseSeconds: policy.firstResponse.thresholdSeconds,
          effectiveFrom: policy.life.effectiveFrom,
          retiredAt: null,
          state: effective > now ? 'scheduled' : 'current',
        };
      }
      return {
        id: policy.id,
        number: index + 1,
        queueWaitSeconds: policy.queueWait.thresholdSeconds,
        firstResponseSeconds: policy.firstResponse.thresholdSeconds,
        effectiveFrom: policy.life.effectiveFrom,
        retiredAt: policy.life.retiredAt,
        state: Date.parse(policy.life.retiredAt) > now ? 'ending' : 'retired',
      };
    })
    .reverse();
}

export const slaStateLabel: Record<SlaVersionState, string> = {
  current: 'Vigente',
  scheduled: 'Agendada',
  ending: 'Vigente até a troca',
  retired: 'Encerrada',
};
