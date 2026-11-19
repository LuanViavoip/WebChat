import { asClientId } from '@viavoip/internal-domain';
import { directConversationId, type ConversationId } from '@viavoip/internal-domain';
import type { UserId } from '@viavoip/internal-domain';
import type { Result } from '@viavoip/internal-domain';
import { ForbiddenError } from '../errors';
import { MockServer, type Delivery, type Outcome, type Session } from './MockServer';
import {
  BV_TENANT_ID,
  BV_USERS,
  createSeedState,
  ICS_TENANT_ID,
  ICS_USERS,
  LIVE_CONVERSATION_ID,
} from './seed';

const NOW = '2026-11-13T12:00:00.000Z';
const session = (userId: UserId, tenantId = ICS_TENANT_ID): Session => ({ tenantId, userId });
const CARLA = session(ICS_USERS.carla);
const ANA = session(ICS_USERS.ana);
const BRUNO = session(ICS_USERS.bruno);
const text = (value: string) => ({ type: 'text' as const, text: value });

function newServer(): MockServer {
  let tick = 0;
  return new MockServer(createSeedState(NOW), {
    now: () => new Date(Date.parse(NOW) + (tick += 1) * 1000).toISOString(),
  });
}

function value<T>(result: Result<T, ForbiddenError>): T {
  if (!result.ok) {
    throw new Error(`esperava sucesso, veio ${result.error.reason}`);
  }
  return result.value;
}

function rejection<T>(outcome: Outcome<T>): ForbiddenError {
  expect(outcome.deliveries).toEqual([]);
  if (outcome.result.ok) {
    throw new Error('esperava ForbiddenError');
  }
  expect(outcome.result.error).toBeInstanceOf(ForbiddenError);
  return outcome.result.error;
}

function sendLive(server: MockServer, from: Session, clientId: string, body = 'oi') {
  return server.send(from, { conversationId: LIVE_CONVERSATION_ID, clientId: asClientId(clientId), payload: text(body) });
}

function recipients(deliveries: readonly Delivery[]): UserId[] {
  return [...new Set(deliveries.map((delivery) => delivery.to))].sort();
}

describe('MockServer', () => {
  describe('connect e bootstrap', () => {
    it('monta o Bootstrap só com dados do tenant e só com as conversas do usuário', () => {
      const server = newServer();
      const bootstrap = value(server.connect(CARLA).result);
      expect(bootstrap.tenant.id).toBe(ICS_TENANT_ID);
      expect(bootstrap.me.id).toBe(ICS_USERS.carla);
      expect(bootstrap.directory.tenantId).toBe(ICS_TENANT_ID);
      expect(Object.values(bootstrap.directory.users).every((user) => user.tenantId === ICS_TENANT_ID)).toBe(true);
      expect(bootstrap.conversations.length).toBeGreaterThan(0);
      for (const summary of bootstrap.conversations) {
        const { conversation } = summary;
        expect(conversation.kind === 'direct' ? conversation.participants.includes(ICS_USERS.carla) : conversation.members.includes(ICS_USERS.carla)).toBe(true);
      }
      // Ana↔Bruno existe na empresa, mas a Carla não participa: não aparece para ela.
      const anaBruno = directConversationId(ICS_TENANT_ID, ICS_USERS.ana, ICS_USERS.bruno);
      expect(bootstrap.conversations.some((summary) => summary.id === anaBruno)).toBe(false);
      expect(Object.keys(bootstrap.recent)).not.toContain(anaBruno);
    });

    it('calcula não lidas e prévia por usuário', () => {
      const server = newServer();
      const carla = value(server.connect(CARLA).result);
      const withAna = carla.conversations.find(
        (summary) => summary.id === directConversationId(ICS_TENANT_ID, ICS_USERS.carla, ICS_USERS.ana),
      );
      expect(withAna).toMatchObject({ unread: 1, preview: 'Ótimo. Qualquer coisa me avisa.' });
      expect(carla.unread).toBeGreaterThanOrEqual(1);
    });

    it('rejeita usuário que não existe na partição (inclui id de outro tenant)', () => {
      const server = newServer();
      rejection(server.connect(session(BV_USERS.paula, ICS_TENANT_ID)));
      rejection(server.connect(session(ICS_USERS.carla, BV_TENANT_ID)));
      rejection(server.connect(session('ninguem' as UserId)));
      rejection(server.connect({ tenantId: 'inexistente' as typeof ICS_TENANT_ID, userId: ICS_USERS.carla }));
    });

    it('grava o último login no fuso da empresa', () => {
      const server = newServer();
      server.connect(CARLA);
      server.connect(session(BV_USERS.paula, BV_TENANT_ID));
      const state = server.getState();
      expect(state.get(ICS_TENANT_ID)?.logins[ICS_USERS.carla]?.lastLoginDate).toBe('2026-11-13');
      expect(state.get(BV_TENANT_ID)?.logins[BV_USERS.paula]?.lastLoginDate).toBe('2026-11-13');
    });

    it('ao conectar, o que estava "enviado" para o usuário vira "entregue" e o autor é avisado', () => {
      const server = newServer();
      const sent = value(sendLive(server, CARLA, 'c-1').result);
      expect(sent.message.status).toBe('sent');
      const connecting = server.connect(BRUNO);
      expect(connecting.deliveries).toEqual([
        {
          to: ICS_USERS.carla,
          event: {
            type: 'status',
            tenantId: ICS_TENANT_ID,
            conversationId: LIVE_CONVERSATION_ID,
            messageId: sent.message.id,
            clientId: 'c-1',
            status: 'delivered',
          },
        },
      ]);
    });
  });

  describe('send', () => {
    it('gera entregas só para os participantes, todas do tenant do evento', () => {
      const server = newServer();
      const outcome = sendLive(server, CARLA, 'c-1', 'olá Bruno');
      const sent = value(outcome.result);
      expect(sent.message).toMatchObject({
        type: 'text',
        text: 'olá Bruno',
        status: 'sent',
        authorId: ICS_USERS.carla,
        tenantId: ICS_TENANT_ID,
        conversationId: LIVE_CONVERSATION_ID,
        clientId: 'c-1',
      });
      expect(outcome.deliveries.map((delivery) => delivery.event.type)).toEqual(['message', 'message']);
      expect(recipients(outcome.deliveries)).toEqual([ICS_USERS.bruno, ICS_USERS.carla]);
      expect(outcome.deliveries.every((delivery) => delivery.event.tenantId === ICS_TENANT_ID)).toBe(true);
    });

    it('com o destinatário conectado, o autor recebe "entregue"', () => {
      const server = newServer();
      server.connect(BRUNO);
      const outcome = sendLive(server, CARLA, 'c-1');
      const statuses = outcome.deliveries.filter((delivery) => delivery.event.type === 'status');
      expect(statuses).toHaveLength(1);
      expect(statuses[0]).toMatchObject({ to: ICS_USERS.carla, event: { status: 'delivered', clientId: 'c-1' } });
    });

    it('o reenvio com o mesmo clientId é idempotente', () => {
      const server = newServer();
      const first = value(sendLive(server, CARLA, 'c-1').result);
      const again = sendLive(server, CARLA, 'c-1');
      expect(again.deliveries).toEqual([]);
      expect(value(again.result).message.id).toBe(first.message.id);
      const messages = server.getState().get(ICS_TENANT_ID)?.messages[LIVE_CONVERSATION_ID] ?? [];
      expect(messages).toHaveLength(1);
    });

    it('mensagem de mídia guarda a URL recebida', () => {
      const server = newServer();
      const outcome = server.send(CARLA, {
        conversationId: LIVE_CONVERSATION_ID,
        clientId: asClientId('img-1'),
        payload: { type: 'image', mimeType: 'image/png', url: 'blob:remote/1', caption: 'rx' },
      });
      expect(value(outcome.result).message).toMatchObject({ type: 'image', url: 'blob:remote/1', caption: 'rx' });
      const stored = server.getState().get(ICS_TENANT_ID)?.messages[LIVE_CONVERSATION_ID]?.[0];
      expect(stored).toMatchObject({ type: 'image', url: 'blob:remote/1' });
    });

    it('recusa texto em branco e mídia sem URL', () => {
      const server = newServer();
      expect(rejection(sendLive(server, CARLA, 'c-1', '   ')).reason).toBe('invalid');
      const media = server.send(CARLA, {
        conversationId: LIVE_CONVERSATION_ID,
        clientId: asClientId('c-2'),
        payload: { type: 'image', mimeType: 'image/png', url: '' },
      });
      expect(rejection(media).reason).toBe('invalid');
    });

    it('recusa quem não participa da conversa', () => {
      const server = newServer();
      expect(rejection(sendLive(server, ANA, 'c-1')).reason).toBe('not-participant');
    });

    it('conversa inexistente ou de outro tenant: ForbiddenError sem dizer se existe', () => {
      const server = newServer();
      const bvConversation = directConversationId(BV_TENANT_ID, BV_USERS.otavio, BV_USERS.paula);
      const foreign = server.send(CARLA, { conversationId: bvConversation, clientId: asClientId('x'), payload: text('oi') });
      const missing = server.send(CARLA, {
        conversationId: 'dm:ics:nao:existe' as ConversationId,
        clientId: asClientId('x'),
        payload: text('oi'),
      });
      expect(rejection(foreign).reason).toBe('forbidden');
      expect(rejection(missing).reason).toBe('forbidden');
      // E o estado de B ficou intacto.
      expect(server.getState().get(BV_TENANT_ID)?.messages[bvConversation]).toHaveLength(2);
    });

    it('usa o ator da PARTIÇÃO: sessão de outro tenant com id de usuário da empresa não envia', () => {
      const server = newServer();
      const forged = session(ICS_USERS.carla, BV_TENANT_ID);
      expect(rejection(sendLive(server, forged, 'c-1')).reason).toBe('forbidden');
    });

    it('agente sem chat.use não envia (a mesma função can)', () => {
      const server = newServer();
      const revoked = server.setGrant(CARLA, { userId: ICS_USERS.bruno, capability: 'chat.use', granted: false });
      expect(value(revoked.result).grants.has('chat.use')).toBe(false);
      expect(rejection(sendLive(server, BRUNO, 'c-1')).reason).toBe('no-chat-use');
      // Quem ainda tem chat.use não consegue abrir direta com quem perdeu.
      expect(rejection(server.openDirect(CARLA, { with: ICS_USERS.bruno })).reason).toBe('target-no-chat-use');
      // Devolvido o grant, volta a enviar.
      server.setGrant(CARLA, { userId: ICS_USERS.bruno, capability: 'chat.use', granted: true });
      expect(value(sendLive(server, BRUNO, 'c-2').result).message.status).toBe('sent');
    });

    it('usuário desativado não envia nem conecta', () => {
      const server = newServer();
      const tenant = server.getState().get(ICS_TENANT_ID);
      const bruno = tenant?.directory.users[ICS_USERS.bruno];
      if (!tenant || !bruno) {
        throw new Error('seed sem o Bruno');
      }
      tenant.directory = { ...tenant.directory, users: { ...tenant.directory.users, [bruno.id]: { ...bruno, active: false } } };
      rejection(server.connect(BRUNO));
      expect(rejection(sendLive(server, BRUNO, 'c-1')).reason).toBe('forbidden');
    });
  });

  describe('markRead', () => {
    it('o destinatário lê: autor recebe status "lida" e os dois recebem o evento read', () => {
      const server = newServer();
      const sent = value(sendLive(server, CARLA, 'c-1').result);
      const outcome = server.markRead(BRUNO, { conversationId: LIVE_CONVERSATION_ID, upToMessageId: sent.message.id });
      expect(outcome.result.ok).toBe(true);
      expect(outcome.deliveries).toContainEqual({
        to: ICS_USERS.carla,
        event: {
          type: 'status',
          tenantId: ICS_TENANT_ID,
          conversationId: LIVE_CONVERSATION_ID,
          messageId: sent.message.id,
          clientId: 'c-1',
          status: 'read',
        },
      });
      const reads = outcome.deliveries.filter((delivery) => delivery.event.type === 'read');
      expect(recipients(reads)).toEqual([ICS_USERS.bruno, ICS_USERS.carla]);
      expect(reads[0]?.event).toMatchObject({ userId: ICS_USERS.bruno, upToMessageId: sent.message.id });
      const stored = server.getState().get(ICS_TENANT_ID)?.messages[LIVE_CONVERSATION_ID]?.[0];
      expect(stored?.status).toBe('read');
    });

    it('zera as não lidas de quem leu e não mexe nas de outro', () => {
      const server = newServer();
      const sent = value(sendLive(server, CARLA, 'c-1').result);
      const bruno = value(server.bootstrap(BRUNO));
      expect(bruno.conversations.find((item) => item.id === LIVE_CONVERSATION_ID)?.unread).toBe(1);
      server.markRead(BRUNO, { conversationId: LIVE_CONVERSATION_ID, upToMessageId: sent.message.id });
      const after = value(server.bootstrap(BRUNO));
      expect(after.conversations.find((item) => item.id === LIVE_CONVERSATION_ID)?.unread).toBe(0);
      const carla = value(server.bootstrap(CARLA));
      expect(carla.conversations.find((item) => item.id === LIVE_CONVERSATION_ID)?.unread).toBe(0);
    });

    it('o autor lendo a própria mensagem não a marca como lida', () => {
      const server = newServer();
      const sent = value(sendLive(server, CARLA, 'c-1').result);
      const outcome = server.markRead(CARLA, { conversationId: LIVE_CONVERSATION_ID, upToMessageId: sent.message.id });
      expect(outcome.deliveries.some((delivery) => delivery.event.type === 'status')).toBe(false);
      expect(server.getState().get(ICS_TENANT_ID)?.messages[LIVE_CONVERSATION_ID]?.[0]?.status).toBe('sent');
    });

    it('recusa mensagem inexistente, conversa alheia e conversa de outro tenant', () => {
      const server = newServer();
      const sent = value(sendLive(server, CARLA, 'c-1').result);
      expect(rejection(server.markRead(BRUNO, { conversationId: LIVE_CONVERSATION_ID, upToMessageId: 'nao-existe' })).reason).toBe('forbidden');
      expect(rejection(server.markRead(ANA, { conversationId: LIVE_CONVERSATION_ID, upToMessageId: sent.message.id })).reason).toBe('not-participant');
      const bvConversation = directConversationId(BV_TENANT_ID, BV_USERS.otavio, BV_USERS.paula);
      expect(rejection(server.markRead(CARLA, { conversationId: bvConversation, upToMessageId: sent.message.id })).reason).toBe('forbidden');
    });
  });

  describe('markRead e setActivity exigem chat.use e participação', () => {
    it('sem chat.use: não lê nem digita (mas ainda conecta)', () => {
      const server = newServer();
      const sent = value(sendLive(server, CARLA, 'c-1').result);
      server.setGrant(CARLA, { userId: ICS_USERS.bruno, capability: 'chat.use', granted: false });
      const read = server.markRead(BRUNO, { conversationId: LIVE_CONVERSATION_ID, upToMessageId: sent.message.id });
      expect(rejection(read).reason).toBe('no-chat-use');
      expect(rejection(server.setActivity(BRUNO, { conversationId: LIVE_CONVERSATION_ID, activity: 'typing' })).reason).toBe('no-chat-use');
      expect(server.connect(BRUNO).result.ok).toBe(true);
      expect(server.getState().get(ICS_TENANT_ID)?.reads[LIVE_CONVERSATION_ID]).toBeUndefined();
    });

    it('não participante, mesmo com chat.use, é recusado', () => {
      const server = newServer();
      const sent = value(sendLive(server, CARLA, 'c-1').result);
      expect(rejection(server.markRead(ANA, { conversationId: LIVE_CONVERSATION_ID, upToMessageId: sent.message.id })).reason).toBe('not-participant');
      expect(rejection(server.setActivity(ANA, { conversationId: LIVE_CONVERSATION_ID, activity: 'idle' })).reason).toBe('not-participant');
    });

    it('sessão de outro tenant e conversa de outro tenant: forbidden', () => {
      const server = newServer();
      const bv = directConversationId(BV_TENANT_ID, BV_USERS.otavio, BV_USERS.paula);
      expect(rejection(server.setActivity(CARLA, { conversationId: bv, activity: 'typing' })).reason).toBe('forbidden');
      expect(rejection(server.markRead(session(BV_USERS.paula, BV_TENANT_ID), { conversationId: LIVE_CONVERSATION_ID, upToMessageId: 'msg:ics:1' })).reason).toBe('forbidden');
    });
  });

  describe('openDirect', () => {
    it('é idempotente: (a,b) e (b,a) dão a mesma conversa e só a primeira avisa', () => {
      const server = newServer();
      const first = server.openDirect(ANA, { with: ICS_USERS.diego });
      const second = server.openDirect(session(ICS_USERS.diego), { with: ICS_USERS.ana });
      const third = server.openDirect(ANA, { with: ICS_USERS.diego });
      const conversation = value(first.result);
      expect(conversation.id).toBe(directConversationId(ICS_TENANT_ID, ICS_USERS.ana, ICS_USERS.diego));
      expect(value(second.result)).toEqual(conversation);
      expect(value(third.result)).toEqual(conversation);
      expect(first.deliveries.map((delivery) => delivery.event.type)).toEqual(['conversation', 'conversation']);
      expect(recipients(first.deliveries)).toEqual([ICS_USERS.ana, ICS_USERS.diego]);
      expect(second.deliveries).toEqual([]);
      expect(third.deliveries).toEqual([]);
    });

    it('a direta nova aparece no Bootstrap dos dois e só deles', () => {
      const server = newServer();
      server.openDirect(ANA, { with: ICS_USERS.diego });
      const id = directConversationId(ICS_TENANT_ID, ICS_USERS.ana, ICS_USERS.diego);
      expect(value(server.bootstrap(ANA)).conversations.some((item) => item.id === id)).toBe(true);
      expect(value(server.bootstrap(session(ICS_USERS.diego))).conversations.some((item) => item.id === id)).toBe(true);
      expect(value(server.bootstrap(CARLA)).conversations.some((item) => item.id === id)).toBe(false);
    });

    it('agente abre direta com agente da mesma empresa', () => {
      const server = newServer();
      expect(server.openDirect(ANA, { with: ICS_USERS.fabio }).result.ok).toBe(true);
    });

    it('usuário de outro tenant: ForbiddenError, sem criar nada nem avisar ninguém', () => {
      const server = newServer();
      const before = JSON.stringify(server.toPersisted());
      const outcome = server.openDirect(CARLA, { with: BV_USERS.paula });
      expect(rejection(outcome).reason).toBe('forbidden');
      expect(JSON.stringify(server.toPersisted())).toBe(before);
    });

    it('recusa abrir direta consigo mesmo e com usuário inexistente', () => {
      const server = newServer();
      expect(rejection(server.openDirect(CARLA, { with: ICS_USERS.carla })).reason).toBe('same-user');
      expect(rejection(server.openDirect(CARLA, { with: 'ninguem' as UserId })).reason).toBe('forbidden');
    });
  });

  describe('typing e grants', () => {
    it('typing vai só aos outros participantes', () => {
      const server = newServer();
      const outcome = server.setActivity(CARLA, { conversationId: LIVE_CONVERSATION_ID, activity: 'typing' });
      expect(outcome.deliveries).toEqual([
        {
          to: ICS_USERS.bruno,
          event: {
            type: 'activity',
            tenantId: ICS_TENANT_ID,
            conversationId: LIVE_CONVERSATION_ID,
            userId: ICS_USERS.carla,
            activity: 'typing',
          },
        },
      ]);
      expect(rejection(server.setActivity(ANA, { conversationId: LIVE_CONVERSATION_ID, activity: 'typing' })).reason).toBe('not-participant');
    });

    it('setGrant usa canGrant: agente não concede, supervisor não concede a si, outro tenant não existe', () => {
      const server = newServer();
      const byAgent = server.setGrant(ANA, { userId: ICS_USERS.bruno, capability: 'chat.use', granted: false });
      expect(rejection(byAgent).reason).toBe('no-grants-manage');
      const self = server.setGrant(CARLA, { userId: ICS_USERS.carla, capability: 'group.manage', granted: false });
      expect(rejection(self).reason).toBe('self');
      const cross = server.setGrant(CARLA, { userId: BV_USERS.paula, capability: 'chat.use', granted: false });
      expect(rejection(cross).reason).toBe('forbidden');
      const bv = server.getState().get(BV_TENANT_ID)?.directory.users[BV_USERS.paula];
      expect(bv?.grants.has('chat.use')).toBe(true);
    });

    it('o grant avisa só os usuários do mesmo tenant', () => {
      const server = newServer();
      const outcome = server.setGrant(CARLA, { userId: ICS_USERS.bruno, capability: 'chat.use', granted: false });
      expect(outcome.deliveries.length).toBeGreaterThan(0);
      expect(outcome.deliveries.every((delivery) => delivery.to.startsWith('ics-'))).toBe(true);
      expect(outcome.deliveries.every((delivery) => delivery.event.tenantId === ICS_TENANT_ID)).toBe(true);
    });
  });

  describe('isolamento', () => {
    it('o Bootstrap de A não contém nenhum id de B', () => {
      const server = newServer();
      for (const who of [CARLA, ANA, session(ICS_USERS.marcos)]) {
        const json = JSON.stringify(value(server.bootstrap(who)), (_key, item: unknown) =>
          item instanceof Set ? [...(item as Set<string>)] : item,
        );
        const state = server.getState().get(BV_TENANT_ID);
        if (!state) {
          throw new Error('seed sem a empresa B');
        }
        const foreignIds = [
          BV_TENANT_ID,
          ...Object.keys(state.directory.users),
          ...Object.keys(state.directory.ilhas),
          ...Object.keys(state.conversations),
          ...Object.values(state.messages).flatMap((list) => list.map((message) => message.id)),
        ];
        expect(foreignIds.length).toBeGreaterThan(10);
        for (const id of foreignIds) {
          expect(json).not.toContain(`"${id}"`);
        }
      }
    });
  });
});
