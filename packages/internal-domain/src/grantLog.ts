import { supervisedIlhaIds } from './capabilities';
import type { GrantLogEntry } from './directoryOps';
import type { Directory, StaffUser } from './identity';
import { own } from './records';

/**
 * Escopo de LEITURA do grantLog (decisão do bloco 2):
 * - admin: o log inteiro da empresa;
 * - supervisor: só as entradas feitas por ele ou cujo alvo é agente de uma ilha que ele supervisiona
 *   (o escopo é o ATUAL: mover um agente de ilha muda o que o supervisor enxerga);
 * - agente: nada.
 * Entrada de outro tenant nunca aparece, mesmo que tenha entrado no array por engano.
 */
export function canReadGrantLog(reader: StaffUser): boolean {
  return reader.role !== 'agent';
}

export function visibleGrantLog(d: Directory, reader: StaffUser, log: readonly GrantLogEntry[]): readonly GrantLogEntry[] {
  if (reader.tenantId !== d.tenantId || !reader.active || !canReadGrantLog(reader)) {
    return [];
  }
  const inTenant = log.filter((entry) => entry.tenantId === d.tenantId);
  if (reader.role === 'admin') {
    return inTenant;
  }
  const ilhas = supervisedIlhaIds(d, reader.id);
  return inTenant.filter((entry) => {
    if (entry.actorId === reader.id) {
      return true;
    }
    const target = own(d.users, entry.targetId);
    return target?.role === 'agent' && ilhas.has(target.ilhaId);
  });
}
