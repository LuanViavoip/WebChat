import { CAPABILITIES, ROLE_DEFAULT, type Capability } from '../../domain/capabilities';
import type { IlhaId, UserId } from '../../domain/identity';
import { ForbiddenError } from '../errors';
import { MockServer, type Delivery, type Outcome, type Session } from './MockServer';
import { BV_ILHAS, BV_TENANT_ID, BV_USERS, createSeedState, ICS_ILHAS, ICS_TENANT_ID, ICS_USERS } from './seed';
import type { PersistedState } from './state';

const NOW = '2026-11-16T12:00:00.000Z';
const session = (userId: UserId, tenantId = ICS_TENANT_ID): Session => ({ tenantId, userId });
const MARCOS = session(ICS_USERS.marcos);
const CARLA = session(ICS_USERS.carla);
const RAFAEL = session(ICS_USERS.rafael);
const ANA = session(ICS_USERS.ana);
const HELENA = session(BV_USERS.helena, BV_TENANT_ID);
const iid = (value: string): IlhaId => value as IlhaId;
const uid = (value: string): UserId => value as UserId;

function newServer(): MockServer {
  let counter = 0;
  return new MockServer(createSeedState(NOW), { now: () => NOW, newId: () => `n${String((counter += 1))}` });
}

/** Tudo que é estado persistido (os dois tenants, com diretório, ilhas, conversas e grantLog). */
function snapshot(server: MockServer): PersistedState {
  return server.toPersisted();
}

function ok<T>(outcome: Outcome<T>): { value: T; deliveries: Delivery[] } {
  if (!outcome.result.ok) {
    throw new Error(`esperava sucesso, veio ${outcome.result.error.reason}`);
  }
  return { value: outcome.result.value, deliveries: outcome.deliveries };
}

/** A operação forjada: ForbiddenError, nenhum evento, e o estado persistido INTEIRO (os 2 tenants + log) idêntico. */
function expectForged(server: MockServer, run: () => Outcome<unknown>, reason?: string): ForbiddenError {
  const before = snapshot(server);
  const outcome = run();
  expect(outcome.deliveries).toEqual([]);
  expect(snapshot(server)).toEqual(before);
  if (outcome.result.ok) {
    throw new Error('esperava ForbiddenError');
  }
  expect(outcome.result.error).toBeInstanceOf(ForbiddenError);
  expect(outcome.result.error.message).toBe('Operação não permitida');
  if (reason !== undefined) {
    expect(outcome.result.error.reason).toBe(reason);
  }
  return outcome.result.error;
}

const recipients = (deliveries: readonly Delivery[], type: Delivery['event']['type']): UserId[] =>
  deliveries
    .filter((delivery) => delivery.event.type === type)
    .map((delivery) => delivery.to)
    .sort();

function tenantUsers(server: MockServer, tenantId = ICS_TENANT_ID): UserId[] {
  return Object.keys(server.getState().get(tenantId)?.directory.users ?? {}).sort() as UserId[];
}

function logOf(server: MockServer, tenantId = ICS_TENANT_ID) {
  return server.getState().get(tenantId)?.grantLog ?? [];
}

describe('MockServer: operações administrativas aceitas', () => {
  it('admin cadastra supervisor: usuário novo ativo, ilhas dele, evento directory só ao tenant', () => {
    const server = newServer();
    const { value, deliveries } = ok(server.registerSupervisor(MARCOS, { name: '  Paula Nova ', ilhaIds: [ICS_ILHAS.exames] }));
    expect(value).toMatchObject({ role: 'supervisor', name: 'Paula Nova', active: true, tenantId: ICS_TENANT_ID });
    expect(value.grants).toEqual(new Set(ROLE_DEFAULT.supervisor));
    const directory = server.getState().get(ICS_TENANT_ID)?.directory;
    expect(directory?.users[value.id]).toEqual(value);
    expect(directory?.ilhas[ICS_ILHAS.exames]?.supervisorId).toBe(value.id);
    expect(recipients(deliveries, 'directory')).toEqual(tenantUsers(server));
    expect(deliveries.every((delivery) => delivery.event.tenantId === ICS_TENANT_ID)).toBe(true);
    expect(logOf(server)).toEqual([]);
  });

  it('o evento directory leva o diretório atualizado (usuários e ilhas) do tenant', () => {
    const server = newServer();
    const { value, deliveries } = ok(server.registerAgent(MARCOS, { name: 'Novo Agente', ilhaId: ICS_ILHAS.sul }));
    const event = deliveries.find((delivery) => delivery.to === ICS_USERS.ana)?.event;
    if (event?.type !== 'directory') {
      throw new Error('esperava directory');
    }
    expect(event.directory.tenantId).toBe(ICS_TENANT_ID);
    expect(event.directory.users[value.id]).toMatchObject({ role: 'agent', ilhaId: ICS_ILHAS.sul });
    expect(Object.values(event.directory.users).every((user) => user.tenantId === ICS_TENANT_ID)).toBe(true);
  });

  it('supervisor cadastra agente numa ilha dele; admin em qualquer ilha', () => {
    const server = newServer();
    const byCarla = ok(server.registerAgent(CARLA, { name: 'Agente da Carla', ilhaId: ICS_ILHAS.sul })).value;
    expect(byCarla).toMatchObject({ role: 'agent', ilhaId: ICS_ILHAS.sul, grants: new Set(['chat.use']) });
    const byMarcos = ok(server.registerAgent(MARCOS, { name: 'Agente de Exames', ilhaId: ICS_ILHAS.exames })).value;
    expect(byMarcos).toMatchObject({ role: 'agent', ilhaId: ICS_ILHAS.exames });
    expect(byCarla.id).not.toBe(byMarcos.id);
  });

  it('desativar e reativar: admin em qualquer um; supervisor no agente da ilha dele; o registro fica', () => {
    const server = newServer();
    const off = ok(server.deactivateUser(CARLA, { userId: ICS_USERS.ana }));
    expect(off.value.active).toBe(false);
    expect(server.getState().get(ICS_TENANT_ID)?.directory.users[ICS_USERS.ana]?.active).toBe(false);
    expect(recipients(off.deliveries, 'directory')).not.toContain(ICS_USERS.ana);
    expect(recipients(off.deliveries, 'directory')).toContain(ICS_USERS.carla);
    const on = ok(server.reactivateUser(MARCOS, { userId: ICS_USERS.ana }));
    expect(on.value.active).toBe(true);
    expect(recipients(on.deliveries, 'directory')).toContain(ICS_USERS.ana);
    ok(server.deactivateUser(MARCOS, { userId: ICS_USERS.rafael }));
    expect(logOf(server)).toEqual([]);
  });

  it('criar, renomear e atribuir supervisor a ilha: só o admin', () => {
    const server = newServer();
    const created = ok(server.createIlha(MARCOS, { name: ' Noite ', supervisorId: ICS_USERS.rafael })).value;
    expect(created).toMatchObject({ name: 'Noite', supervisorId: ICS_USERS.rafael, tenantId: ICS_TENANT_ID });
    const renamed = ok(server.renameIlha(MARCOS, { ilhaId: created.id, name: 'Madrugada' }));
    expect(renamed.value.name).toBe('Madrugada');
    expect(recipients(renamed.deliveries, 'directory')).toEqual(tenantUsers(server));
    const assigned = ok(server.assignIlhaSupervisor(MARCOS, { ilhaId: created.id, supervisorId: ICS_USERS.carla }));
    expect(assigned.value.supervisorId).toBe(ICS_USERS.carla);
    expect(server.getState().get(ICS_TENANT_ID)?.directory.ilhas[created.id]).toEqual(assigned.value);
  });

  it('mover agente: o supervisor com origem E destino dele; o admin, qualquer ilha', () => {
    const server = newServer();
    expect(ok(server.moveAgent(CARLA, { userId: ICS_USERS.ana, ilhaId: ICS_ILHAS.sul })).value).toMatchObject({ ilhaId: ICS_ILHAS.sul });
    expect(ok(server.moveAgent(MARCOS, { userId: ICS_USERS.elisa, ilhaId: ICS_ILHAS.norte })).value).toMatchObject({ ilhaId: ICS_ILHAS.norte });
  });

  it('revogar e conceder: grava o grantLog (quem, para quem, o quê, quando) e emite grants + grantLog', () => {
    const server = newServer();
    const revoked = ok(server.setGrant(MARCOS, { userId: ICS_USERS.carla, capability: 'group.manage', granted: false }));
    expect(revoked.value.grants.has('group.manage')).toBe(false);
    expect(logOf(server)).toEqual([
      { tenantId: ICS_TENANT_ID, actorId: ICS_USERS.marcos, targetId: ICS_USERS.carla, capability: 'group.manage', granted: false, at: NOW },
    ]);
    expect(recipients(revoked.deliveries, 'grants')).toEqual(tenantUsers(server));
    // Só o admin enxerga esta entrada: o alvo é supervisor, não agente de ilha de ninguém.
    expect(recipients(revoked.deliveries, 'grantLog')).toEqual([ICS_USERS.marcos]);
    const granted = ok(server.setGrant(MARCOS, { userId: ICS_USERS.carla, capability: 'group.manage', granted: true }));
    expect(granted.value.grants.has('group.manage')).toBe(true);
    expect(logOf(server).map((entry) => entry.granted)).toEqual([false, true]);
  });

  it('grantLog de supervisor: o evento vai ao admin e ao supervisor do agente, nunca ao outro supervisor', () => {
    const server = newServer();
    const { deliveries } = ok(server.setGrant(CARLA, { userId: ICS_USERS.ana, capability: 'chat.use', granted: false }));
    expect(recipients(deliveries, 'grantLog')).toEqual([ICS_USERS.carla, ICS_USERS.marcos]);
    const forCarla = deliveries.find((delivery) => delivery.event.type === 'grantLog' && delivery.to === ICS_USERS.carla)?.event;
    expect(forCarla).toMatchObject({ type: 'grantLog', entries: [{ actorId: ICS_USERS.carla, targetId: ICS_USERS.ana }] });
  });

  it('mover o agente muda o que o supervisor enxerga e avisa só quem teve o log alterado', () => {
    const server = newServer();
    ok(server.setGrant(MARCOS, { userId: ICS_USERS.ana, capability: 'chat.use', granted: false }));
    // Ana está em Norte (Carla): Carla vê a entrada; Rafael não.
    const carlaSees = server.grantLog(CARLA);
    expect(carlaSees.ok && carlaSees.value.length).toBe(1);
    const moved = ok(server.moveAgent(MARCOS, { userId: ICS_USERS.ana, ilhaId: ICS_ILHAS.exames }));
    expect(recipients(moved.deliveries, 'grantLog')).toEqual([ICS_USERS.carla, ICS_USERS.rafael]);
    const forCarla = moved.deliveries.find((delivery) => delivery.event.type === 'grantLog' && delivery.to === ICS_USERS.carla)?.event;
    expect(forCarla).toMatchObject({ entries: [] });
  });

  it('no-change é sucesso idempotente: sem evento, sem log, estado idêntico', () => {
    const server = newServer();
    const before = snapshot(server);
    const outcomes: Array<Outcome<unknown>> = [
      server.setGrant(MARCOS, { userId: ICS_USERS.carla, capability: 'group.manage', granted: true }),
      server.setGrant(MARCOS, { userId: ICS_USERS.ana, capability: 'chat.use', granted: true }),
      server.reactivateUser(MARCOS, { userId: ICS_USERS.ana }),
      server.renameIlha(MARCOS, { ilhaId: ICS_ILHAS.norte, name: 'Norte' }),
      server.assignIlhaSupervisor(MARCOS, { ilhaId: ICS_ILHAS.norte, supervisorId: ICS_USERS.carla }),
      server.moveAgent(MARCOS, { userId: ICS_USERS.ana, ilhaId: ICS_ILHAS.norte }),
    ];
    for (const outcome of outcomes) {
      expect(ok(outcome).deliveries).toEqual([]);
    }
    expect(snapshot(server)).toEqual(before);
  });

  it('o grantLog lido: admin vê o da empresa; supervisor o das ilhas dele; agente é negado', () => {
    const server = newServer();
    ok(server.setGrant(MARCOS, { userId: ICS_USERS.ana, capability: 'chat.use', granted: false })); // norte
    ok(server.setGrant(MARCOS, { userId: ICS_USERS.elisa, capability: 'chat.use', granted: false })); // exames
    const read = (who: Session) => {
      const result = server.grantLog(who);
      return result.ok ? result.value.map((entry) => entry.targetId) : result.error;
    };
    expect(read(MARCOS)).toEqual([ICS_USERS.ana, ICS_USERS.elisa]);
    expect(read(CARLA)).toEqual([ICS_USERS.ana]);
    expect(read(RAFAEL)).toEqual([ICS_USERS.elisa]);
    const agent = read(ANA);
    expect(agent).toBeInstanceOf(ForbiddenError);
    expect(read(HELENA)).toEqual([]);
  });
});

describe('MockServer: operações forjadas (ForbiddenError, sem log, sem evento, estado idêntico)', () => {
  it('supervisor → supervisor: nada (conceder, revogar, desativar, cadastrar, atribuir ilha)', () => {
    const server = newServer();
    expectForged(server, () => server.setGrant(CARLA, { userId: ICS_USERS.rafael, capability: 'group.manage', granted: false }), 'not-higher-rank');
    expectForged(server, () => server.setGrant(CARLA, { userId: ICS_USERS.rafael, capability: 'chat.use', granted: true }), 'not-higher-rank');
    expectForged(server, () => server.deactivateUser(CARLA, { userId: ICS_USERS.rafael }), 'no-manage-capability');
    expectForged(server, () => server.registerSupervisor(CARLA, { name: 'Outro', ilhaIds: [] }), 'no-manage-capability');
    expectForged(server, () => server.assignIlhaSupervisor(CARLA, { ilhaId: ICS_ILHAS.exames, supervisorId: ICS_USERS.carla }), 'no-manage-capability');
    expectForged(server, () => server.createIlha(CARLA, { name: 'X', supervisorId: ICS_USERS.carla }));
    expectForged(server, () => server.renameIlha(CARLA, { ilhaId: ICS_ILHAS.norte, name: 'Outro nome' }));
  });

  it('supervisor nunca mexe no admin', () => {
    const server = newServer();
    expectForged(server, () => server.setGrant(CARLA, { userId: ICS_USERS.marcos, capability: 'chat.use', granted: false }));
    expectForged(server, () => server.deactivateUser(CARLA, { userId: ICS_USERS.marcos }));
  });

  it('agente → qualquer um: nada, nem ler o grantLog', () => {
    const server = newServer();
    for (const target of [ICS_USERS.bruno, ICS_USERS.carla, ICS_USERS.marcos, ICS_USERS.camila]) {
      expectForged(server, () => server.setGrant(ANA, { userId: target, capability: 'chat.use', granted: false }));
      expectForged(server, () => server.setGrant(ANA, { userId: target, capability: 'chat.use', granted: true }));
      expectForged(server, () => server.deactivateUser(ANA, { userId: target }));
      expectForged(server, () => server.reactivateUser(ANA, { userId: target }));
    }
    expectForged(server, () => server.registerAgent(ANA, { name: 'X', ilhaId: ICS_ILHAS.norte }));
    expectForged(server, () => server.registerSupervisor(ANA, { name: 'X', ilhaIds: [] }));
    expectForged(server, () => server.createIlha(ANA, { name: 'X', supervisorId: ICS_USERS.carla }));
    expectForged(server, () => server.renameIlha(ANA, { ilhaId: ICS_ILHAS.norte, name: 'X' }));
    expectForged(server, () => server.assignIlhaSupervisor(ANA, { ilhaId: ICS_ILHAS.norte, supervisorId: ICS_USERS.rafael }));
    expectForged(server, () => server.moveAgent(ANA, { userId: ICS_USERS.bruno, ilhaId: ICS_ILHAS.sul }));
    const log = server.grantLog(ANA);
    expect(log.ok).toBe(false);
  });

  it('self-grant: admin e supervisor não alteram a si mesmos', () => {
    const server = newServer();
    expectForged(server, () => server.setGrant(MARCOS, { userId: ICS_USERS.marcos, capability: 'chat.use', granted: false }), 'self');
    expectForged(server, () => server.setGrant(CARLA, { userId: ICS_USERS.carla, capability: 'group.manage', granted: false }), 'self');
    expectForged(server, () => server.setGrant(CARLA, { userId: ICS_USERS.carla, capability: 'group.manage', granted: true }), 'self');
    expectForged(server, () => server.deactivateUser(MARCOS, { userId: ICS_USERS.marcos }), 'self');
    expectForged(server, () => server.deactivateUser(CARLA, { userId: ICS_USERS.carla }), 'self');
    expectForged(server, () => server.reactivateUser(CARLA, { userId: ICS_USERS.carla }), 'self');
  });

  it('supervisor só gerencia as ilhas dele: conceder, revogar, mover, desativar e cadastrar fora dela', () => {
    const server = newServer();
    // Elisa e Fábio são de Exames (Rafael). Carla supervisiona Norte e Sul.
    expectForged(server, () => server.setGrant(CARLA, { userId: ICS_USERS.elisa, capability: 'chat.use', granted: false }), 'outside-islands');
    expectForged(server, () => server.setGrant(CARLA, { userId: ICS_USERS.elisa, capability: 'chat.use', granted: true }), 'outside-islands');
    expectForged(server, () => server.deactivateUser(CARLA, { userId: ICS_USERS.elisa }), 'outside-islands');
    expectForged(server, () => server.reactivateUser(CARLA, { userId: ICS_USERS.elisa }), 'outside-islands');
    expectForged(server, () => server.registerAgent(CARLA, { name: 'Intruso', ilhaId: ICS_ILHAS.exames }), 'outside-islands');
    // Origem dela, destino alheio.
    expectForged(server, () => server.moveAgent(CARLA, { userId: ICS_USERS.ana, ilhaId: ICS_ILHAS.exames }), 'outside-islands');
    // Origem alheia, destino dela.
    expectForged(server, () => server.moveAgent(CARLA, { userId: ICS_USERS.elisa, ilhaId: ICS_ILHAS.norte }), 'outside-islands');
    // E o inverso para o outro supervisor.
    expectForged(server, () => server.setGrant(RAFAEL, { userId: ICS_USERS.ana, capability: 'chat.use', granted: false }), 'outside-islands');
    expectForged(server, () => server.moveAgent(RAFAEL, { userId: ICS_USERS.elisa, ilhaId: ICS_ILHAS.norte }), 'outside-islands');
  });

  it('supervisor nunca concede o que não tem', () => {
    const server = newServer();
    ok(server.setGrant(MARCOS, { userId: ICS_USERS.carla, capability: 'chat.use', granted: false }));
    ok(server.setGrant(MARCOS, { userId: ICS_USERS.ana, capability: 'chat.use', granted: false }));
    const logBefore = [...logOf(server)];
    expectForged(server, () => server.setGrant(CARLA, { userId: ICS_USERS.ana, capability: 'chat.use', granted: true }), 'actor-lacks-capability');
    expect(logOf(server)).toEqual(logBefore);
  });

  it('capacidade acima do teto do alvo (agente) e supervisor atribuindo papel acima', () => {
    const server = newServer();
    for (const capability of CAPABILITIES.filter((item) => item !== 'chat.use')) {
      expectForged(server, () => server.setGrant(MARCOS, { userId: ICS_USERS.ana, capability, granted: true }), 'above-target-ceiling');
    }
    expectForged(server, () => server.setGrant(CARLA, { userId: ICS_USERS.ana, capability: 'agents.manage', granted: true }));
  });

  it('cross-tenant: alvo, ilha e supervisor de outra empresa são recusados em todas as operações', () => {
    const server = newServer();
    const cases: Array<[string, () => Outcome<unknown>]> = [
      ['grant', () => server.setGrant(MARCOS, { userId: BV_USERS.paula, capability: 'chat.use', granted: true })],
      ['revoke', () => server.setGrant(MARCOS, { userId: BV_USERS.paula, capability: 'chat.use', granted: false })],
      ['revoke supervisor', () => server.setGrant(MARCOS, { userId: BV_USERS.otavio, capability: 'group.manage', granted: false })],
      ['revoke admin', () => server.setGrant(MARCOS, { userId: BV_USERS.helena, capability: 'chat.use', granted: false })],
      ['desativar', () => server.deactivateUser(MARCOS, { userId: BV_USERS.paula })],
      ['reativar', () => server.reactivateUser(MARCOS, { userId: BV_USERS.paula })],
      ['cadastrar agente em ilha alheia', () => server.registerAgent(MARCOS, { name: 'X', ilhaId: BV_ILHAS.atendimento })],
      ['cadastrar supervisor com ilha alheia', () => server.registerSupervisor(MARCOS, { name: 'X', ilhaIds: [BV_ILHAS.atendimento] })],
      ['mover agente alheio', () => server.moveAgent(MARCOS, { userId: BV_USERS.paula, ilhaId: ICS_ILHAS.norte })],
      ['mover para ilha alheia', () => server.moveAgent(MARCOS, { userId: ICS_USERS.ana, ilhaId: BV_ILHAS.atendimento })],
      ['criar ilha com supervisor alheio', () => server.createIlha(MARCOS, { name: 'X', supervisorId: BV_USERS.otavio })],
      ['renomear ilha alheia', () => server.renameIlha(MARCOS, { ilhaId: BV_ILHAS.atendimento, name: 'X' })],
      ['atribuir supervisor alheio', () => server.assignIlhaSupervisor(MARCOS, { ilhaId: ICS_ILHAS.norte, supervisorId: BV_USERS.otavio })],
      ['atribuir a ilha alheia', () => server.assignIlhaSupervisor(MARCOS, { ilhaId: BV_ILHAS.atendimento, supervisorId: ICS_USERS.carla })],
      ['supervisor: grant', () => server.setGrant(CARLA, { userId: BV_USERS.paula, capability: 'chat.use', granted: false })],
      ['supervisor: cadastrar em ilha alheia', () => server.registerAgent(CARLA, { name: 'X', ilhaId: BV_ILHAS.atendimento })],
      ['supervisor: mover', () => server.moveAgent(CARLA, { userId: ICS_USERS.ana, ilhaId: BV_ILHAS.atendimento })],
    ];
    for (const [, run] of cases) {
      const error = expectForged(server, run);
      expect(error.reason).toBe('forbidden');
    }
  });

  it('a mesma classe, a mesma mensagem e o mesmo motivo para "não existe" e "é de outra empresa"', () => {
    const server = newServer();
    const ghost = uid('fantasma');
    const ghostIlha = iid('ilha-fantasma');
    const pairs: Array<[() => Outcome<unknown>, () => Outcome<unknown>]> = [
      [
        () => server.setGrant(MARCOS, { userId: BV_USERS.paula, capability: 'chat.use', granted: false }),
        () => server.setGrant(MARCOS, { userId: ghost, capability: 'chat.use', granted: false }),
      ],
      [
        () => server.deactivateUser(MARCOS, { userId: BV_USERS.paula }),
        () => server.deactivateUser(MARCOS, { userId: ghost }),
      ],
      [
        () => server.reactivateUser(CARLA, { userId: BV_USERS.paula }),
        () => server.reactivateUser(CARLA, { userId: ghost }),
      ],
      [
        () => server.registerAgent(MARCOS, { name: 'X', ilhaId: BV_ILHAS.atendimento }),
        () => server.registerAgent(MARCOS, { name: 'X', ilhaId: ghostIlha }),
      ],
      [
        () => server.registerSupervisor(MARCOS, { name: 'X', ilhaIds: [BV_ILHAS.atendimento] }),
        () => server.registerSupervisor(MARCOS, { name: 'X', ilhaIds: [ghostIlha] }),
      ],
      [
        () => server.moveAgent(MARCOS, { userId: BV_USERS.paula, ilhaId: ICS_ILHAS.sul }),
        () => server.moveAgent(MARCOS, { userId: ghost, ilhaId: ICS_ILHAS.sul }),
      ],
      [
        () => server.moveAgent(MARCOS, { userId: ICS_USERS.ana, ilhaId: BV_ILHAS.atendimento }),
        () => server.moveAgent(MARCOS, { userId: ICS_USERS.ana, ilhaId: ghostIlha }),
      ],
      [
        () => server.createIlha(MARCOS, { name: 'X', supervisorId: BV_USERS.otavio }),
        () => server.createIlha(MARCOS, { name: 'X', supervisorId: ghost }),
      ],
      [
        () => server.renameIlha(MARCOS, { ilhaId: BV_ILHAS.atendimento, name: 'X' }),
        () => server.renameIlha(MARCOS, { ilhaId: ghostIlha, name: 'X' }),
      ],
      [
        () => server.assignIlhaSupervisor(MARCOS, { ilhaId: ICS_ILHAS.norte, supervisorId: BV_USERS.otavio }),
        () => server.assignIlhaSupervisor(MARCOS, { ilhaId: ICS_ILHAS.norte, supervisorId: ghost }),
      ],
      [
        () => server.assignIlhaSupervisor(MARCOS, { ilhaId: BV_ILHAS.atendimento, supervisorId: ICS_USERS.carla }),
        () => server.assignIlhaSupervisor(MARCOS, { ilhaId: ghostIlha, supervisorId: ICS_USERS.carla }),
      ],
    ];
    for (const [foreign, missing] of pairs) {
      const a = expectForged(server, foreign);
      const b = expectForged(server, missing);
      expect(a.constructor).toBe(b.constructor);
      expect(a.message).toBe(b.message);
      expect(a.reason).toBe(b.reason);
      expect(a.reason).toBe('forbidden');
    }
  });

  it('o motivo detalhado só aparece dentro do tenant (outro supervisor da mesma empresa)', () => {
    const server = newServer();
    expect(expectForged(server, () => server.setGrant(CARLA, { userId: ICS_USERS.elisa, capability: 'chat.use', granted: false })).reason).toBe('outside-islands');
    expect(expectForged(server, () => server.registerAgent(MARCOS, { name: '   ', ilhaId: ICS_ILHAS.norte })).reason).toBe('invalid-name');
  });

  it('usuário desativado como ator: sessão antiga não opera mais, em nada', () => {
    const server = newServer();
    ok(server.deactivateUser(MARCOS, { userId: ICS_USERS.carla }));
    expectForged(server, () => server.setGrant(CARLA, { userId: ICS_USERS.ana, capability: 'chat.use', granted: false }));
    expectForged(server, () => server.registerAgent(CARLA, { name: 'X', ilhaId: ICS_ILHAS.norte }));
    expectForged(server, () => server.deactivateUser(CARLA, { userId: ICS_USERS.ana }));
    expectForged(server, () => server.moveAgent(CARLA, { userId: ICS_USERS.ana, ilhaId: ICS_ILHAS.sul }));
    expectForged(server, () => server.send(CARLA, { conversationId: 'x' as never, clientId: 'c', payload: { type: 'text', text: 'oi' } }));
    expectForged(server, () => server.openDirect(CARLA, { with: ICS_USERS.ana }));
    expect(server.grantLog(CARLA).ok).toBe(false);
    expect(server.bootstrap(CARLA).ok).toBe(false);
  });

  it('admin desativado também perde o poder', () => {
    const server = new MockServer(createSeedState(NOW), { now: () => NOW });
    const state = server.getState().get(ICS_TENANT_ID);
    const marcos = state?.directory.users[ICS_USERS.marcos];
    if (!state || !marcos) {
      throw new Error('seed');
    }
    state.directory = { ...state.directory, users: { ...state.directory.users, [marcos.id]: { ...marcos, active: false } } };
    expectForged(server, () => server.setGrant(MARCOS, { userId: ICS_USERS.carla, capability: 'group.manage', granted: false }));
    expectForged(server, () => server.createIlha(MARCOS, { name: 'X', supervisorId: ICS_USERS.carla }));
  });

  it('sessão forjada (tenant trocado ou usuário de outra empresa) não existe', () => {
    const server = newServer();
    const wrongTenant = session(ICS_USERS.marcos, BV_TENANT_ID);
    const foreignUser = session(BV_USERS.helena, ICS_TENANT_ID);
    for (const forged of [wrongTenant, foreignUser, session(uid('ninguem'))]) {
      expectForged(server, () => server.setGrant(forged, { userId: ICS_USERS.ana, capability: 'chat.use', granted: false }), 'forbidden');
      expectForged(server, () => server.registerAgent(forged, { name: 'X', ilhaId: ICS_ILHAS.norte }), 'forbidden');
      expectForged(server, () => server.createIlha(forged, { name: 'X', supervisorId: ICS_USERS.carla }), 'forbidden');
    }
  });

  it('nome inválido, ilha obrigatória e rebaixar quem supervisiona não passam', () => {
    const server = newServer();
    expectForged(server, () => server.registerSupervisor(MARCOS, { name: '', ilhaIds: [] }), 'invalid-name');
    expectForged(server, () => server.createIlha(MARCOS, { name: '\u0000', supervisorId: ICS_USERS.carla }), 'invalid-name');
    expectForged(server, () => server.renameIlha(MARCOS, { ilhaId: ICS_ILHAS.norte, name: ' '.repeat(3) }), 'invalid-name');
    expectForged(server, () => server.moveAgent(MARCOS, { userId: ICS_USERS.carla, ilhaId: ICS_ILHAS.norte }), 'target-not-agent');
  });

  it('o ator vem da sessão: o request não tem campo de ator e um campo extra é ignorado', () => {
    const server = newServer();
    // Um chamador mal-intencionado tenta empurrar `actorId` no request. O servidor só olha a sessão.
    const forged = { userId: ICS_USERS.bruno, capability: 'chat.use' as Capability, granted: false, actorId: ICS_USERS.marcos };
    expectForged(server, () => server.setGrant(ANA, forged));
    expect(logOf(server)).toEqual([]);
  });

  it('isolamento do estado: operações do ICS não tocam nada do BV (diretório, conversas, log)', () => {
    const server = newServer();
    const bvBefore = JSON.stringify(snapshot(server).tenants.find((tenant) => tenant.tenant.id === BV_TENANT_ID));
    ok(server.registerAgent(MARCOS, { name: 'Novo', ilhaId: ICS_ILHAS.sul }));
    ok(server.setGrant(MARCOS, { userId: ICS_USERS.ana, capability: 'chat.use', granted: false }));
    ok(server.deactivateUser(MARCOS, { userId: ICS_USERS.bruno }));
    ok(server.createIlha(MARCOS, { name: 'Nova', supervisorId: ICS_USERS.rafael }));
    expect(JSON.stringify(snapshot(server).tenants.find((tenant) => tenant.tenant.id === BV_TENANT_ID))).toBe(bvBefore);
    expect(logOf(server, BV_TENANT_ID)).toEqual([]);
    // E o admin do BV só enxerga o log do BV.
    ok(server.setGrant(HELENA, { userId: BV_USERS.paula, capability: 'chat.use', granted: false }));
    const bvLog = server.grantLog(HELENA);
    expect(bvLog.ok && bvLog.value.map((entry) => entry.tenantId)).toEqual([BV_TENANT_ID]);
  });
});
