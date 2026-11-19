import { asClientId, directConversationId } from '@viavoip/internal-domain';
import type { ChatEvent, ChatTransport, ConnectRequest } from './ChatTransport';
import { ForbiddenError } from './errors';
import {
  BV_TENANT_ID,
  BV_USERS,
  ICS_ILHAS,
  ICS_TENANT_ID,
  ICS_USERS,
  LIVE_CONVERSATION_ID,
} from './mock/seed';

export type TransportHarness = {
  /** Cria uma instância de `ChatTransport` ligada ao mesmo servidor/estado desta execução. */
  createTransport: () => ChatTransport;
  cleanup?: () => void | Promise<void>;
};

const CARLA: ConnectRequest = { tenantId: ICS_TENANT_ID, userId: ICS_USERS.carla };
const BRUNO: ConnectRequest = { tenantId: ICS_TENANT_ID, userId: ICS_USERS.bruno };
const ANA: ConnectRequest = { tenantId: ICS_TENANT_ID, userId: ICS_USERS.ana };
const MARCOS: ConnectRequest = { tenantId: ICS_TENANT_ID, userId: ICS_USERS.marcos };
const PAULA: ConnectRequest = { tenantId: BV_TENANT_ID, userId: BV_USERS.paula };

function collect(transport: ChatTransport): ChatEvent[] {
  const events: ChatEvent[] = [];
  transport.subscribe((event) => {
    events.push(event);
  });
  return events;
}

async function expectForbidden(promise: Promise<unknown>): Promise<ForbiddenError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(ForbiddenError);
    if (error instanceof ForbiddenError) {
      return error;
    }
  }
  throw new Error('Esperava ForbiddenError');
}

export function defineChatTransportContract(
  name: string,
  make: () => TransportHarness | Promise<TransportHarness>,
): void {
  describe(`ChatTransport contract: ${name}`, () => {
    let harness: TransportHarness;

    beforeEach(async () => {
      harness = await make();
    });

    afterEach(async () => {
      await harness.cleanup?.();
    });

    describe('connect e Bootstrap v1', () => {
      it('emite connecting → connected e devolve Bootstrap v1 apenas do tenant', async () => {
        const carla = harness.createTransport();
        const events = collect(carla);
        const bootstrap = await carla.connect(CARLA);

        expect(events.map((event) => event.type)).toEqual(['connection', 'connection']);
        expect(carla.getStatus()).toBe('connected');
        expect(bootstrap.tenant.id).toBe(ICS_TENANT_ID);
        expect(bootstrap.me.id).toBe(ICS_USERS.carla);
        expect(bootstrap.directory.tenantId).toBe(ICS_TENANT_ID);
        expect(bootstrap.serverNow).toMatch(/^\d{4}-\d{2}-\d{2}T/);
        expect(bootstrap.firstLoginOfDay).toBe(true);
        expect(bootstrap.presence[ICS_USERS.carla]).toMatchObject({
          userId: ICS_USERS.carla,
          online: true,
          status: { kind: 'available' },
        });
        expect(bootstrap.presence[BV_USERS.paula]).toBeUndefined();
        expect(bootstrap.prefs).toEqual({});
        expect(bootstrap.starred).toEqual([]);
        expect(bootstrap.pinnedMessages).toEqual({});
        expect(bootstrap.reactions).toEqual({});
        expect(bootstrap.polls).toEqual({});
        expect(bootstrap.quickReplies).toEqual([]);
        expect(bootstrap.scheduled).toEqual([]);
        expect(bootstrap.announcements).toEqual({ board: [], authored: [] });
      });

      it('marca firstLoginOfDay=false no segundo connect do mesmo dia', async () => {
        const carla = harness.createTransport();
        const first = await carla.connect(CARLA);
        expect(first.firstLoginOfDay).toBe(true);
        carla.disconnect();

        const again = await carla.connect(CARLA);
        expect(again.firstLoginOfDay).toBe(false);
      });

      it('rejeita usuário de outro tenant ou inexistente com ForbiddenError', async () => {
        const transport = harness.createTransport();
        await expectForbidden(transport.connect({ tenantId: ICS_TENANT_ID, userId: BV_USERS.paula }));
        expect(transport.loginGroups().map((group) => group.tenant.id)).toContain(ICS_TENANT_ID);
      });
    });

    describe('send e idempotência', () => {
      it('entrega mensagem ao participante conectado e ignora reenvio idempotente por clientId', async () => {
        const carla = harness.createTransport();
        const bruno = harness.createTransport();
        const paula = harness.createTransport();
        const brunoEvents = collect(bruno);
        const paulaEvents = collect(paula);
        await carla.connect(CARLA);
        await bruno.connect(BRUNO);
        await paula.connect(PAULA);
        brunoEvents.length = 0;
        paulaEvents.length = 0;

        const clientId = asClientId('contract-send-1');
        await carla.send({
          conversationId: LIVE_CONVERSATION_ID,
          clientId,
          payload: { type: 'text', text: 'Olá pelo contrato' },
        });
        await carla.send({
          conversationId: LIVE_CONVERSATION_ID,
          clientId,
          payload: { type: 'text', text: 'Olá pelo contrato' },
        });

        await vi.waitFor(() => {
          expect(brunoEvents.filter((event) => event.type === 'message')).toHaveLength(1);
        });
        expect(paulaEvents).toEqual([]);
      });

      it('rejeita send fora da conversa ou de outro tenant com ForbiddenError', async () => {
        const ana = harness.createTransport();
        await ana.connect(ANA);
        await expectForbidden(
          ana.send({
            conversationId: LIVE_CONVERSATION_ID,
            clientId: asClientId('denied-send'),
            payload: { type: 'text', text: 'não participo' },
          }),
        );
      });
    });

    describe('markRead', () => {
      it('emite evento read para participantes e rejeita não participante', async () => {
        const carla = harness.createTransport();
        const bruno = harness.createTransport();
        const ana = harness.createTransport();
        const carlaEvents = collect(carla);
        const brunoEvents = collect(bruno);
        await carla.connect(CARLA);
        await bruno.connect(BRUNO);
        await ana.connect(ANA);
        carlaEvents.length = 0;
        brunoEvents.length = 0;

        await carla.send({
          conversationId: LIVE_CONVERSATION_ID,
          clientId: asClientId('contract-read-1'),
          payload: { type: 'text', text: 'Confirmar leitura' },
        });
        await vi.waitFor(() => {
          expect(brunoEvents.some((event) => event.type === 'message')).toBe(true);
        });
        const msgEvent = brunoEvents.find((event) => event.type === 'message');
        if (msgEvent?.type !== 'message') {
          throw new Error('Mensagem esperada');
        }

        await bruno.markRead({ conversationId: LIVE_CONVERSATION_ID, upToMessageId: msgEvent.message.id });
        await vi.waitFor(() => {
          expect(carlaEvents.some((event) => event.type === 'read' && event.upToMessageId === msgEvent.message.id)).toBe(
            true,
          );
        });
        await expectForbidden(
          ana.markRead({ conversationId: LIVE_CONVERSATION_ID, upToMessageId: msgEvent.message.id }),
        );
      });
    });

    describe('openDirect', () => {
      it('abre direta com colega do mesmo tenant e recusa outro tenant ou a si mesmo', async () => {
        const ana = harness.createTransport();
        const bruno = harness.createTransport();
        await ana.connect(ANA);
        await bruno.connect(BRUNO);

        const direct = await ana.openDirect({ with: ICS_USERS.diego });
        expect(direct.id).toBe(directConversationId(ICS_TENANT_ID, ICS_USERS.ana, ICS_USERS.diego));
        await expectForbidden(ana.openDirect({ with: ICS_USERS.ana }));
        await expectForbidden(ana.openDirect({ with: BV_USERS.paula }));
      });
    });

    describe('activity', () => {
      it('emite typing, recording-audio e idle apenas para os demais participantes', async () => {
        const carla = harness.createTransport();
        const bruno = harness.createTransport();
        const carlaEvents = collect(carla);
        const brunoEvents = collect(bruno);
        await carla.connect(CARLA);
        await bruno.connect(BRUNO);
        carlaEvents.length = 0;
        brunoEvents.length = 0;

        carla.setActivity({ conversationId: LIVE_CONVERSATION_ID, activity: 'typing' });
        carla.setActivity({ conversationId: LIVE_CONVERSATION_ID, activity: 'recording-audio' });
        carla.setActivity({ conversationId: LIVE_CONVERSATION_ID, activity: 'idle' });

        await vi.waitFor(() => {
          expect(brunoEvents.filter((event) => event.type === 'activity')).toHaveLength(3);
        });
        expect(brunoEvents.filter((event) => event.type === 'activity').map((event) => event.activity)).toEqual([
          'typing',
          'recording-audio',
          'idle',
        ]);
        expect(carlaEvents.some((event) => event.type === 'activity')).toBe(false);
      });
    });

    describe('grupos', () => {
      it('cria grupo idempotente, remove membro com conversation-removed e permite sair de custom mas não de ilha', async () => {
        const carla = harness.createTransport();
        const ana = harness.createTransport();
        const anaEvents = collect(ana);
        await carla.connect(CARLA);
        const anaBoot = await ana.connect(ANA);
        anaEvents.length = 0;

        const created = await carla.createGroup({
          clientId: 'contract-grp-1',
          title: 'Contrato Grupo',
          memberIds: [ICS_USERS.carla, ICS_USERS.ana],
          ilhaId: null,
        });
        const duplicate = await carla.createGroup({
          clientId: 'contract-grp-1',
          title: 'Contrato Grupo',
          memberIds: [ICS_USERS.carla, ICS_USERS.ana],
          ilhaId: null,
        });
        expect(duplicate.id).toBe(created.id);

        await carla.updateGroup({ conversationId: created.id, remove: [ICS_USERS.ana] });
        await vi.waitFor(() => {
          expect(
            anaEvents.some((event) => event.type === 'conversation-removed' && event.conversationId === created.id),
          ).toBe(true);
        });
        await expectForbidden(
          ana.send({
            conversationId: created.id,
            clientId: asClientId('after-remove'),
            payload: { type: 'text', text: 'bloqueado' },
          }),
        );

        const ilhaGroup = anaBoot.conversations.find(
          (summary) => summary.conversation.kind === 'group' && summary.conversation.origin.kind === 'ilha',
        );
        if (!ilhaGroup) {
          throw new Error('Grupo de ilha esperado na seed');
        }
        await expectForbidden(ana.leaveGroup({ conversationId: ilhaGroup.id }));

        const customGroup = await carla.createGroup({
          clientId: 'contract-grp-leave',
          title: 'Grupo Saída',
          memberIds: [ICS_USERS.carla, ICS_USERS.ana],
          ilhaId: null,
        });
        const left = await ana.leaveGroup({ conversationId: customGroup.id });
        expect(left.members).not.toContain(ICS_USERS.ana);
      });
    });

    describe('administração', () => {
      it('cadastra ilha/usuários, concede permissão no grantLog, desativa sessão e rejeita não autorizado', async () => {
        const marcos = harness.createTransport();
        const ana = harness.createTransport();
        const anaEvents = collect(ana);
        await marcos.connect(MARCOS);
        await ana.connect(ANA);
        anaEvents.length = 0;

        await expectForbidden(ana.registerAgent({ name: 'Sem Permissão', ilhaIds: [ICS_ILHAS.norte] }));
        expect(anaEvents).toEqual([]);

        const supervisor = await marcos.registerSupervisor({ name: 'Supervisora Contrato', ilhaIds: [] });
        const ilha = await marcos.createIlha({ name: 'Ilha Contrato', supervisorIds: [supervisor.id] });
        await marcos.renameIlha({ ilhaId: ilha.id, name: 'Ilha Renomeada' });
        const agent = await marcos.registerAgent({ name: 'Agente Contrato', ilhaIds: [ilha.id] });
        await marcos.addAgentToIlha({ userId: agent.id, ilhaId: ICS_ILHAS.sul });
        await marcos.removeAgentFromIlha({ userId: agent.id, ilhaId: ICS_ILHAS.sul });
        await marcos.assignIlhaSupervisor({ ilhaId: ilha.id, supervisorId: ICS_USERS.carla });
        await marcos.unassignIlhaSupervisor({ ilhaId: ilha.id, supervisorId: ICS_USERS.carla });

        await marcos.setGrant({ userId: supervisor.id, capability: 'group.manage', granted: false });
        const log = await marcos.grantLog();
        expect(log.some((entry) => entry.targetId === supervisor.id && entry.capability === 'group.manage')).toBe(true);

        await marcos.deactivateUser({ userId: ICS_USERS.ana });
        await vi.waitFor(() => {
          expect(anaEvents.some((event) => event.type === 'session-ended')).toBe(true);
        });
        await marcos.reactivateUser({ userId: ICS_USERS.ana });
      });
    });

    describe('invariantes v1 (spec B.4)', () => {
      it.todo('B.4.1: nenhum evento, Bootstrap ou resposta das operações novas atravessa tenant');
      it.todo('B.4.2: toda operação sobre mensagem exige can(actor, conversation.send, conversa); ex-membro não reage, edita, vota nem encaminha');
      it.todo('B.4.3: idempotência por clientId vale para send, forward, schedule e publishAnnouncement');
      it.todo('B.4.4: eventos receipt e resposta de messageInfo vão apenas ao autor da mensagem');
      it.todo('B.4.5: DeletedMessage não preserva o conteúdo original no estado persistido nem nos eventos');
      it.todo('B.4.6: toda operação negada rejeita com ForbiddenError e não emite nenhum evento');
    });

    describe('operações novas v1 (spec B.4)', () => {
      it.todo('upload (announcement-draft): exige announcement.publish e aceita mídia válida de aviso');
      it.todo('history: pagina mensagens anteriores por before e filtra por kinds (galeria)');
      it.todo('react: adiciona, troca e remove reação e emite evento reaction aos participantes');
      it.todo('editMessage: edita texto ou legenda dentro de 15 min e emite message-updated');
      it.todo('deleteMessage: apaga para todos (tombstone sem conteúdo) ou para mim (message-hidden)');
      it.todo('forward: encaminha para até 5 destinos com selo ForwardMark e idempotência por clientId');
      it.todo('setStar: favorita/desfavorita mensagem e emite star apenas para o ator');
      it.todo('pinMessage: fixa até 3 mensagens na conversa e emite pinned-messages');
      it.todo('messageInfo: devolve recibos por destinatário exclusivamente para o autor');
      it.todo('searchMessages: busca mensagens por termo (≥ 2 caracteres) respeitando visibilidade do ator');
      it.todo('setPresence: atualiza presença (available, pause, away) e emite presence no tenant');
      it.todo('setConversationPrefs: fixa (máx. 3), arquiva e silencia conversa emitindo prefs ao usuário');
      it.todo('votePoll: registra ou retira voto em grupo e emite poll com tally atualizado');
      it.todo('closePoll: encerra enquete pelo autor ou gestor do grupo e emite atualização');
      it.todo('schedule: agenda mensagem ou lembrete (idempotente por clientId) e emite scheduled');
      it.todo('cancelScheduled: cancela item pendente e emite scheduled atualizado');
      it.todo('saveQuickReply: cria/edita resposta rápida pessoal, de ilha ou da empresa emitindo quick-replies');
      it.todo('deleteQuickReply: remove resposta rápida conforme permissão de escopo');
      it.todo('publishAnnouncement: publica aviso (board ou interrupt) para o público resolvido e emite eventos');
      it.todo('editAnnouncement: cria revisão material (reabre ciência) ou correção não material');
      it.todo('markAnnouncementViewed: registra visualização idempotente e atualiza tally do autor');
      it.todo('reportPlayback: avança maxPositionMs monotonicamente e conclui played ao atingir ≥ 95%');
      it.todo('acknowledgeAnnouncement: registra 👍 e recusa playback-required quando mídia obrigatória não terminou');
      it.todo('announcementReceipts: retorna painel completo por ilha e histórico de revisões para autor/admin');
      it.todo('remindAnnouncement: envia announcement-reminder aos pendentes respeitando limite de 10 min');
      it.todo('forwardAnnouncement: encaminha apenas referência para destinos totalmente cobertos pelo público');
    });
  });
}
