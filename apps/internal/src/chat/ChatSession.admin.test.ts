import { icsDirectory, ICS_ILHAS, ICS_TENANT_ID, ICS_USERS, BV_TENANT_ID, BV_USERS, DEFAULT_SESSION } from '../transport/mock/seed';
import type { GrantLogEntry } from '../domain/directoryOps';
import type { Directory } from '../domain/identity';
import { ScriptedTransport } from '../test/scriptedTransport';
import { ForbiddenError, ACCOUNT_DEACTIVATED } from '../transport/errors';
import { ChatSession, SESSION_DEACTIVATED_TEXT } from './ChatSession';

async function started(transport = new ScriptedTransport()): Promise<{ session: ChatSession; transport: ScriptedTransport }> {
  const session = new ChatSession(transport, { identity: DEFAULT_SESSION });
  await session.start();
  return { session, transport };
}

const entry = (targetId: string, granted = false): GrantLogEntry => ({
  tenantId: ICS_TENANT_ID,
  actorId: ICS_USERS.carla,
  targetId: targetId as GrantLogEntry['targetId'],
  capability: 'chat.use',
  granted,
  at: '2026-11-16T10:00:00.000Z',
});

describe('ChatSession: ações de administração', () => {
  it('cada ação chama o transporte com os parâmetros certos e NUNCA com ator ou tenant', async () => {
    const { session, transport } = await started();
    await session.registerSupervisor('Nova', [ICS_ILHAS.sul]);
    await session.registerAgent('Agente', ICS_ILHAS.norte);
    await session.deactivateUser(ICS_USERS.ana);
    await session.reactivateUser(ICS_USERS.ana);
    await session.createIlha('Noite', ICS_USERS.rafael);
    await session.renameIlha(ICS_ILHAS.norte, 'Norte 2');
    await session.assignIlhaSupervisor(ICS_ILHAS.norte, ICS_USERS.rafael);
    await session.moveAgent(ICS_USERS.ana, ICS_ILHAS.sul);
    await session.setGrant(ICS_USERS.ana, 'chat.use', false);
    expect(transport.adminCalls).toEqual([
      { method: 'registerSupervisor', request: { name: 'Nova', ilhaIds: [ICS_ILHAS.sul] } },
      { method: 'registerAgent', request: { name: 'Agente', ilhaId: ICS_ILHAS.norte } },
      { method: 'deactivateUser', request: { userId: ICS_USERS.ana } },
      { method: 'reactivateUser', request: { userId: ICS_USERS.ana } },
      { method: 'createIlha', request: { name: 'Noite', supervisorId: ICS_USERS.rafael } },
      { method: 'renameIlha', request: { ilhaId: ICS_ILHAS.norte, name: 'Norte 2' } },
      { method: 'assignIlhaSupervisor', request: { ilhaId: ICS_ILHAS.norte, supervisorId: ICS_USERS.rafael } },
      { method: 'moveAgent', request: { userId: ICS_USERS.ana, ilhaId: ICS_ILHAS.sul } },
      { method: 'setGrant', request: { userId: ICS_USERS.ana, capability: 'chat.use', granted: false } },
    ]);
    for (const call of transport.adminCalls) {
      expect(JSON.stringify(call.request)).not.toMatch(/actor|tenant/i);
    }
    session.stop();
  });

  it('negação com motivo vira mensagem em português; sem motivo, mensagem genérica que não revela nada', async () => {
    const { session, transport } = await started();
    transport.adminError = new ForbiddenError('outside-islands');
    expect(await session.setGrant(ICS_USERS.elisa, 'chat.use', false)).toEqual({
      ok: false,
      message: 'Operação não permitida: fora das suas ilhas.',
    });
    transport.adminError = new ForbiddenError('self');
    expect(await session.deactivateUser(ICS_USERS.carla)).toEqual({ ok: false, message: 'Operação não permitida: não pode alterar a si mesmo.' });
    transport.adminError = new ForbiddenError();
    const generic = await session.moveAgent(BV_USERS.paula, ICS_ILHAS.sul);
    expect(generic).toEqual({ ok: false, message: 'Operação não permitida.' });
    transport.adminError = new ForbiddenError('motivo-inventado');
    expect(await session.moveAgent(ICS_USERS.ana, ICS_ILHAS.sul)).toEqual({ ok: false, message: 'Operação não permitida.' });
    transport.adminError = new Error('rede caiu');
    expect(await session.renameIlha(ICS_ILHAS.norte, 'X')).toEqual({ ok: false, message: 'rede caiu' });
    session.stop();
  });

  it('o resultado de sucesso é ok e não mexe no estado local (quem muda o estado são os eventos)', async () => {
    const { session } = await started();
    const before = session.getState();
    expect(await session.renameIlha(ICS_ILHAS.norte, 'Outro')).toMatchObject({ ok: true, value: { id: ICS_ILHAS.norte } });
    expect(session.getState().directory).toEqual(before.directory);
    session.stop();
  });
});

describe('ChatSession: diretório, grants e grantLog reativos a eventos', () => {
  it('o evento directory atualiza o diretório e o `me`, sem reload', async () => {
    const { session, transport } = await started();
    const next: Directory = icsDirectory();
    const carla = next.users[ICS_USERS.carla];
    if (!carla) {
      throw new Error('seed');
    }
    const novo = { ...carla, id: 'ics-novo' as typeof carla.id, name: 'Novo Colega' };
    const directory: Directory = {
      ...next,
      users: { ...next.users, [carla.id]: { ...carla, name: 'Carla Renomeada' }, [novo.id]: novo },
    };
    transport.emit({ type: 'directory', tenantId: ICS_TENANT_ID, directory });
    const state = session.getState();
    expect(state.directory?.users[novo.id]?.name).toBe('Novo Colega');
    expect(state.me?.name).toBe('Carla Renomeada');
    session.stop();
  });

  it('diretório de outra empresa ou sem o usuário logado é ignorado', async () => {
    const { session, transport } = await started();
    const before = session.getState().directory;
    transport.emit({ type: 'directory', tenantId: BV_TENANT_ID, directory: { ...icsDirectory(), tenantId: BV_TENANT_ID } });
    const withoutMe = icsDirectory();
    const rest = Object.fromEntries(Object.entries(withoutMe.users).filter(([id]) => id !== ICS_USERS.carla));
    transport.emit({ type: 'directory', tenantId: ICS_TENANT_ID, directory: { ...withoutMe, users: rest } });
    transport.emit({ type: 'directory', tenantId: ICS_TENANT_ID, directory: { ...icsDirectory(), tenantId: BV_TENANT_ID } });
    expect(session.getState().directory).toBe(before);
    session.stop();
  });

  it('o grantLog começa nulo, carrega por loadGrantLog e o evento o mantém atualizado', async () => {
    const { session, transport } = await started();
    expect(session.getState().grantLog).toBeNull();
    transport.grantLogEntries = [entry(ICS_USERS.ana)];
    expect(await session.loadGrantLog()).toEqual({ ok: true });
    expect(session.getState().grantLog).toEqual([entry(ICS_USERS.ana)]);
    transport.emit({ type: 'grantLog', tenantId: ICS_TENANT_ID, entries: [entry(ICS_USERS.ana), entry(ICS_USERS.bruno, true)] });
    expect(session.getState().grantLog).toHaveLength(2);
    session.stop();
  });

  it('entradas de outro tenant e eventos de outro tenant nunca entram no grantLog', async () => {
    const { session, transport } = await started();
    transport.emit({ type: 'grantLog', tenantId: BV_TENANT_ID, entries: [entry(ICS_USERS.ana)] });
    expect(session.getState().grantLog).toBeNull();
    transport.emit({
      type: 'grantLog',
      tenantId: ICS_TENANT_ID,
      entries: [entry(ICS_USERS.ana), { ...entry(ICS_USERS.bruno), tenantId: BV_TENANT_ID }],
    });
    expect(session.getState().grantLog).toEqual([entry(ICS_USERS.ana)]);
    session.stop();
  });

  it('uma leitura que volta DEPOIS de um evento mais novo é descartada', async () => {
    const { session, transport } = await started();
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const read = transport.grantLog.bind(transport);
    transport.grantLog = async () => {
      const stale = await read();
      await gate;
      return stale;
    };
    transport.grantLogEntries = [entry(ICS_USERS.ana)];
    const loading = session.loadGrantLog();
    transport.emit({ type: 'grantLog', tenantId: ICS_TENANT_ID, entries: [entry(ICS_USERS.ana), entry(ICS_USERS.bruno)] });
    release();
    await loading;
    expect(session.getState().grantLog).toHaveLength(2);
    session.stop();
  });

  it('agente: loadGrantLog falha com mensagem e o grantLog segue nulo', async () => {
    const { session, transport } = await started();
    transport.adminError = new ForbiddenError('no-capability');
    const result = await session.loadGrantLog();
    expect(result.ok).toBe(false);
    expect(session.getState().grantLog).toBeNull();
    session.stop();
  });

  it('o evento grants atualiza as permissões do usuário logado', async () => {
    const { session, transport } = await started();
    transport.emit({ type: 'grants', tenantId: ICS_TENANT_ID, userId: ICS_USERS.carla, grants: ['chat.use'] });
    expect([...(session.getState().me?.grants ?? [])]).toEqual(['chat.use']);
    session.stop();
  });
});

describe('ChatSession: sessão encerrada pelo servidor', () => {
  it('session-ended expõe a mensagem, derruba a conexão e some ao recomeçar', async () => {
    const { session, transport } = await started();
    transport.emit({ type: 'session-ended', tenantId: ICS_TENANT_ID, reason: 'deactivated' });
    expect(session.getState().sessionEnded).toEqual({ reason: 'deactivated', message: SESSION_DEACTIVATED_TEXT });
    expect(session.getState().connection).toBe('disconnected');
    await session.start();
    expect(session.getState().sessionEnded).toBeNull();
    session.stop();
  });

  it('um bootstrap aplicado com sucesso (reconexão depois de reativada) zera o sessionEnded', async () => {
    const { session, transport } = await started();
    transport.emit({ type: 'session-ended', tenantId: ICS_TENANT_ID, reason: 'deactivated' });
    expect(session.getState().sessionEnded).not.toBeNull();
    transport.disconnect();
    await session.reconnect();
    const state = session.getState();
    expect(state.sessionEnded).toBeNull();
    expect(state.connection).toBe('connected');
    expect(state.me?.id).toBe(DEFAULT_SESSION.userId);
    session.stop();
  });

  it('um connect que falha NÃO zera o sessionEnded (só o bootstrap aceito zera)', async () => {
    const { session, transport } = await started();
    transport.emit({ type: 'session-ended', tenantId: ICS_TENANT_ID, reason: 'deactivated' });
    transport.disconnect();
    transport.connectError = new ForbiddenError();
    await session.reconnect();
    expect(session.getState().sessionEnded).not.toBeNull();
    session.stop();
  });

  it('as ações devolvem o usuário/ilha que o servidor criou (a UI seleciona o item novo)', async () => {
    const { session } = await started();
    expect(await session.registerAgent('Zélia', ICS_ILHAS.norte)).toMatchObject({ ok: true, value: { id: ICS_USERS.ana, role: 'agent' } });
    session.stop();
  });

  it('session-ended de outro tenant é ignorado', async () => {
    const { session, transport } = await started();
    transport.emit({ type: 'session-ended', tenantId: BV_TENANT_ID, reason: 'deactivated' });
    expect(session.getState().sessionEnded).toBeNull();
    expect(session.getState().connection).toBe('connected');
    session.stop();
  });

  it('connect recusado por conta desativada vira sessionEnded (e não "falha de conexão")', async () => {
    const transport = new ScriptedTransport();
    transport.connectError = new ForbiddenError(ACCOUNT_DEACTIVATED);
    const { session } = await started(transport);
    const state = session.getState();
    expect(state.sessionEnded?.message).toBe('Sua conta foi desativada. Fale com o administrador.');
    expect(state.error).toBeNull();
    expect(state.me).toBeNull();
    session.stop();
  });

  it('outro erro de connect continua sendo erro de conexão', async () => {
    const transport = new ScriptedTransport();
    transport.connectError = new ForbiddenError();
    const { session } = await started(transport);
    expect(session.getState().sessionEnded).toBeNull();
    expect(session.getState().connection).toBe('error');
    expect(session.getState().error).not.toBeNull();
    session.stop();
  });
});
