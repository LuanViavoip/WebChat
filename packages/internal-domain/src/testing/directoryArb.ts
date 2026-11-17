import fc from 'fast-check';
import type { Agent, Directory, Ilha, IlhaId, StaffUser, Supervisor } from '../identity';
import { T1, iid, makeUser, uid } from './domainFixtures';

/**
 * Gerador de diretórios VÁLIDOS no modelo N:N (plano da fusão, C2/D1):
 * - 1 admin ativo;
 * - 1 a 4 supervisores (ativos ou não);
 * - 1 a 4 ilhas, cada uma com 1 a 3 supervisores (o tipo admite 0, mas uma ilha com agentes sem
 *   supervisor é `orphan-agent`; ilha sem supervisor e sem agente é coberta à parte nos testes);
 * - 0 a 8 agentes, cada um em 1 a 3 ilhas (o tipo exige ao menos uma: `[IlhaId, ...IlhaId[]]`).
 */
export type DirectoryShape = {
  readonly supervisors: number;
  readonly ilhaSupervisors: readonly (readonly number[])[];
  readonly agentIlhas: readonly (readonly number[])[];
};

function pickSome(n: number, min: number, max: number): fc.Arbitrary<number[]> {
  return fc.uniqueArray(fc.integer({ min: 0, max: n - 1 }), { minLength: Math.min(min, n), maxLength: Math.min(max, n) });
}

export const directoryShapeArb: fc.Arbitrary<DirectoryShape> = fc
  .record({ supervisors: fc.integer({ min: 1, max: 4 }), ilhas: fc.integer({ min: 1, max: 4 }), agents: fc.integer({ min: 0, max: 8 }) })
  .chain(({ supervisors, ilhas, agents }) =>
    fc.record({
      supervisors: fc.constant(supervisors),
      ilhaSupervisors: fc.tuple(...Array.from({ length: ilhas }, () => pickSome(supervisors, 1, 3))),
      agentIlhas: fc.tuple(...Array.from({ length: agents }, () => pickSome(ilhas, 1, 3))),
    }),
  );

export function directoryFromShape(shape: DirectoryShape, activeFlags: readonly boolean[] = []): Directory {
  const supervisors: Supervisor[] = Array.from({ length: shape.supervisors }, (_, i) => {
    const user = makeUser('supervisor', `s${String(i)}`, { active: activeFlags[i] ?? true });
    return user as Supervisor;
  });
  const ilhas: Ilha[] = shape.ilhaSupervisors.map((supIdx, i) => ({
    id: iid(`i${String(i)}`),
    tenantId: T1,
    name: `i${String(i)}`,
    supervisorIds: supIdx.map((s) => uid(`s${String(s)}`)),
  }));
  const agents: Agent[] = shape.agentIlhas.map((ilhaIdx, i) => {
    const ids: IlhaId[] = ilhaIdx.map((x) => iid(`i${String(x)}`));
    return makeUser('agent', `a${String(i)}`, { ilhaIds: ids }) as Agent;
  });
  const users: StaffUser[] = [makeUser('admin', 'admin'), ...supervisors, ...agents];
  return {
    tenantId: T1,
    users: Object.fromEntries(users.map((u) => [u.id, u])),
    ilhas: Object.fromEntries(ilhas.map((i) => [i.id, i])),
  };
}

/** Diretório N:N válido arbitrário (supervisores todos ativos). */
export const directoryArb: fc.Arbitrary<Directory> = directoryShapeArb.map((shape) => directoryFromShape(shape));
