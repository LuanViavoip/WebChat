import { asClientId } from '@viavoip/internal-domain';
import { ChatSession, SESSION_DEACTIVATED_TEXT } from '../../chat/ChatSession';
import { Lab, type Probe } from '../../test/adminProbe';
import { FakeBus } from '../../test/fakeBroadcastChannel';
import type { UserId } from '@viavoip/internal-domain';
import type { ChatEvent, ConnectRequest } from '../ChatTransport';
import { ACCOUNT_DEACTIVATED, ForbiddenError } from '../errors';
import { MockTransport } from './MockTransport';
import { BV_TENANT_ID, BV_USERS, ICS_TENANT_ID, ICS_ILHAS, ICS_USERS, LIVE_CONVERSATION_ID } from './seed';

const as = (tenantId: typeof ICS_TENANT_ID, userId: UserId): ConnectRequest => ({ tenantId, userId });
const MARCOS = as(ICS_TENANT_ID, ICS_USERS.marcos);
const CARLA = as(ICS_TENANT_ID, ICS_USERS.carla);
const BRUNO = as(ICS_TENANT_ID, ICS_USERS.bruno);
const ANA = as(ICS_TENANT_ID, ICS_USERS.ana);

let lab: Lab;
beforeEach(() => {
  lab = new Lab();
});
afterEach(() => {
  lab.close();
});

const ended = (probe: Probe): ChatEvent[] => probe.events.filter((event) => event.type === 'session-ended');

async function connectError(transport: MockTransport, request: ConnectRequest): Promise<unknown> {
  return transport.connect(request).then(
    () => undefined,
    (error: unknown) => error,
  );
}

describe('usuário desativado', () => {
  it('connect é rejeitado com o motivo claro, e a conta não aparece como conectada', async () => {
    const backend = lab.tab();
    const marcos = await lab.join(backend, MARCOS);
    await marcos.transport.deactivateUser({ userId: ICS_USERS.bruno });
    const transport = new MockTransport({ backend, delays: { connectMs: 0 } });
    const error = await connectError(transport, BRUNO);
    expect(error).toBeInstanceOf(ForbiddenError);
    expect(error instanceof ForbiddenError && error.reason).toBe(ACCOUNT_DEACTIVATED);
    expect(transport.getStatus()).toBe('error');
    expect(backend.server.isOnline(ICS_TENANT_ID, ICS_USERS.bruno)).toBe(false);
  });

  it('só quem acerta empresa E id recebe o motivo: tenant trocado e id inexistente dão o erro genérico', async () => {
    const backend = lab.tab();
    const helena = await lab.join(backend, as(BV_TENANT_ID, BV_USERS.helena));
    await helena.transport.deactivateUser({ userId: BV_USERS.paula });
    const transport = new MockTransport({ backend, delays: { connectMs: 0 } });
    const wrongTenant = await connectError(transport, as(ICS_TENANT_ID, BV_USERS.paula));
    const ghost = await connectError(transport, as(ICS_TENANT_ID, 'ics-fantasma' as UserId));
    for (const error of [wrongTenant, ghost]) {
      expect(error).toBeInstanceOf(ForbiddenError);
      expect(error instanceof ForbiddenError && error.reason).toBe('forbidden');
    }
    // O ICS não consegue descobrir que a Paula do BV está desativada.
    expect(wrongTenant instanceof ForbiddenError && ghost instanceof ForbiddenError && wrongTenant.message === ghost.message).toBe(true);
  });

  it('a sessão conectada cai na hora, em todas as abas, com a mensagem em português', async () => {
    const bus = new FakeBus();
    const tabA = lab.tab(bus);
    const tabB = lab.tab(bus);
    const marcos = await lab.join(tabA, MARCOS);
    const here = await lab.join(tabA, BRUNO);
    const there = await lab.join(tabB, BRUNO);
    const carla = await lab.join(tabB, CARLA);
    await marcos.transport.deactivateUser({ userId: ICS_USERS.bruno });
    for (const probe of [here, there]) {
      expect(ended(probe)).toEqual([{ type: 'session-ended', tenantId: ICS_TENANT_ID, reason: 'deactivated' }]);
      expect(probe.transport.getStatus()).toBe('disconnected');
    }
    expect(tabA.server.isOnline(ICS_TENANT_ID, ICS_USERS.bruno)).toBe(false);
    expect(tabB.server.isOnline(ICS_TENANT_ID, ICS_USERS.bruno)).toBe(false);
    // Os outros não são tocados.
    expect(carla.transport.getStatus()).toBe('connected');
    expect(ended(carla)).toEqual([]);
    expect(ended(marcos)).toEqual([]);
  });

  it('a ChatSession expõe sessionEnded com a mensagem clara (queda e connect recusado)', async () => {
    const backend = lab.tab();
    const marcos = await lab.join(backend, MARCOS);
    const session = new ChatSession(new MockTransport({ backend, delays: { connectMs: 0 } }), { identity: BRUNO });
    await session.start();
    expect(session.getState().sessionEnded).toBeNull();
    expect(session.getState().connection).toBe('connected');
    await marcos.transport.deactivateUser({ userId: ICS_USERS.bruno });
    expect(session.getState().sessionEnded).toEqual({ reason: 'deactivated', message: 'Sua conta foi desativada. Fale com o administrador.' });
    expect(SESSION_DEACTIVATED_TEXT).toBe('Sua conta foi desativada. Fale com o administrador.');
    expect(session.getState().connection).toBe('disconnected');
    expect(session.getState().error).toBeNull();
    session.stop();

    const retry = new ChatSession(new MockTransport({ backend, delays: { connectMs: 0 } }), { identity: BRUNO });
    await retry.start();
    expect(retry.getState().sessionEnded?.message).toBe(SESSION_DEACTIVATED_TEXT);
    expect(retry.getState().me).toBeNull();
    expect(retry.getState().error).toBeNull();
    retry.stop();
  });

  it('sessão derrubada não chama mais nenhum método (transporte e servidor)', async () => {
    const backend = lab.tab();
    const marcos = await lab.join(backend, MARCOS);
    const bruno = await lab.join(backend, BRUNO);
    await marcos.transport.deactivateUser({ userId: ICS_USERS.bruno });
    const t = bruno.transport;
    const calls: Array<Promise<unknown>> = [
      t.send({ conversationId: LIVE_CONVERSATION_ID, clientId: asClientId('c'), payload: { type: 'text', text: 'oi' } }),
      t.markRead({ conversationId: LIVE_CONVERSATION_ID, upToMessageId: 'm' }),
      t.openDirect({ with: ICS_USERS.ana }),
      t.setGrant({ userId: ICS_USERS.ana, capability: 'chat.use', granted: false }),
      t.registerAgent({ name: 'X', ilhaIds: [ICS_ILHAS.norte]}),
      t.deactivateUser({ userId: ICS_USERS.ana }),
      t.grantLog(),
    ];
    for (const call of calls) {
      await expect(call).rejects.toThrow();
    }
    // Mesmo com a sessão antiga em mãos, o SERVIDOR recusa (cada método revalida a conta).
    const stale = { tenantId: ICS_TENANT_ID, userId: ICS_USERS.bruno };
    const server = backend.server;
    const before = JSON.stringify(server.toPersisted());
    for (const outcome of [
      server.send(stale, { conversationId: LIVE_CONVERSATION_ID, clientId: asClientId('c'), payload: { type: 'text', text: 'oi' } }),
      server.openDirect(stale, { with: ICS_USERS.ana }),
      server.setTyping(stale, { conversationId: LIVE_CONVERSATION_ID, isTyping: true }),
      server.deliverPending(stale),
      server.setGrant(stale, { userId: ICS_USERS.ana, capability: 'chat.use', granted: false }),
    ]) {
      expect(outcome.result.ok).toBe(false);
      expect(outcome.deliveries).toEqual([]);
    }
    expect(server.grantLog(stale).ok).toBe(false);
    expect(server.bootstrap(stale).ok).toBe(false);
    expect(JSON.stringify(server.toPersisted())).toBe(before);
  });

  it('o histórico fica, e reativar volta a entrar com as mensagens de antes', async () => {
    const backend = lab.tab();
    const marcos = await lab.join(backend, MARCOS);
    const ana = await lab.join(backend, ANA);
    const bruno = await lab.join(backend, BRUNO);
    const conversation = (await bruno.transport.openDirect({ with: ICS_USERS.ana })).id;
    await bruno.transport.send({ conversationId: conversation, clientId: asClientId('antes'), payload: { type: 'text', text: 'mensagem de antes' } });
    const countBefore = backend.server.getState().get(ICS_TENANT_ID)?.messages[conversation]?.length;

    await marcos.transport.deactivateUser({ userId: ICS_USERS.bruno });
    const messages = backend.server.getState().get(ICS_TENANT_ID)?.messages[conversation] ?? [];
    expect(messages).toHaveLength(countBefore ?? -1);
    expect(messages.some((message) => message.authorId === ICS_USERS.bruno && message.type === 'text' && message.text === 'mensagem de antes')).toBe(true);
    expect(backend.server.getState().get(ICS_TENANT_ID)?.directory.users[ICS_USERS.bruno]).toMatchObject({ active: false, name: 'Bruno Costa' });
    // Ana não consegue abrir conversa com quem está desativado, mas a existente continua no estado dela.
    await expect(ana.transport.openDirect({ with: ICS_USERS.bruno })).rejects.toBeInstanceOf(ForbiddenError);

    await marcos.transport.reactivateUser({ userId: ICS_USERS.bruno });
    const again = new MockTransport({ backend, delays: { connectMs: 0 } });
    const bootstrap = await again.connect(BRUNO);
    expect(bootstrap.me.active).toBe(true);
    expect(bootstrap.recent[conversation]?.some((message) => message.type === 'text' && message.text === 'mensagem de antes')).toBe(true);
    expect(again.getStatus()).toBe('connected');
    again.disconnect();
  });

  it('reativar não ressuscita a sessão antiga: a derrubada vale, e o usuário precisa entrar de novo', async () => {
    const backend = lab.tab();
    const marcos = await lab.join(backend, MARCOS);
    const bruno = await lab.join(backend, BRUNO);
    await marcos.transport.deactivateUser({ userId: ICS_USERS.bruno });
    await marcos.transport.reactivateUser({ userId: ICS_USERS.bruno });
    expect(bruno.transport.getStatus()).toBe('disconnected');
    await expect(bruno.transport.openDirect({ with: ICS_USERS.ana })).rejects.toThrow();
  });

  it('supervisor desativado perde poder e acesso; reativado volta a operar', async () => {
    const backend = lab.tab();
    const marcos = await lab.join(backend, MARCOS);
    const carla = await lab.join(backend, CARLA);
    await marcos.transport.deactivateUser({ userId: ICS_USERS.carla });
    expect(carla.transport.getStatus()).toBe('disconnected');
    await marcos.transport.reactivateUser({ userId: ICS_USERS.carla });
    const back = await lab.join(backend, CARLA);
    await back.transport.setGrant({ userId: ICS_USERS.ana, capability: 'chat.use', granted: false });
    expect((await marcos.transport.grantLog()).map((entry) => entry.actorId)).toEqual([ICS_USERS.carla]);
  });
});
