import type { ConversationSummary } from '@viavoip/protocol';
import { isStaff } from '../domain/access.js';
import { DomainError } from '../domain/errors.js';
import {
  agentClientSchemas,
  conversationActionSchema,
  conversationCloseSchema,
  conversationStartSchema,
  conversationTransferSchema,
  historySyncSchema,
  messageReadCommandSchema,
  messageSendSchema,
  presenceSetSchema,
  supervisorClientSchemas,
  surveySubmitSchema,
  visitorClientSchemas,
} from '@viavoip/protocol';
import type { SMAdapter } from '@viavoip/sm-adapter';
import type { Namespace, Server, Socket } from 'socket.io';
import type { ZodType } from 'zod';
import { SessionService } from '../auth/sessions.js';
import { readHandshakeToken } from '../auth/handshake.js';
import type { AgentPrincipal, VisitorPrincipal } from '../domain/types.js';
import { ConversationService } from '../modules/conversations.js';
import { MessageService } from '../modules/messages.js';
import { PresenceService } from '../modules/presence.js';
import type { ActivityService } from '../modules/activities.js';
import type { AnnouncementService } from '../modules/announcements.js';
import type { InternalChatService } from '../modules/internal-chat.js';
import type { SectorService } from '../modules/sectors.js';
import type { SupervisorService } from '../modules/supervisor.js';
import { afterSessionValidation, bindSocket, joinSessionRoom } from './bind.js';
import { joinOwnRooms, staffHandlers, type StaffDeps } from './staff-channel.js';
import { SocketHub } from './hub.js';
import type { SlidingWindowLimiter } from '../http/rate-limit.js';
import type { AppLogger } from './logger.js';
import { safeNotify } from './logger.js';
import { rooms } from './rooms.js';
import type { QueuePosition } from '@viavoip/protocol';

export type RealtimeDeps = {
  sessions: SessionService;
  conversations: ConversationService;
  messages: MessageService;
  presence: PresenceService;
  sectors: SectorService;
  internalChat: InternalChatService;
  announcements: AnnouncementService;
  activities: ActivityService;
  supervisor: SupervisorService;
  sm: SMAdapter;
  hub: SocketHub;
  logger: AppLogger;
  limiter: SlidingWindowLimiter;
  messageLimit: number;
};

export function registerRealtime(io: Server, deps: RealtimeDeps): void {
  registerVisitor(io.of('/visitor'), deps);
  registerAgent(io.of('/agent'), deps);
  registerSupervisor(io.of('/supervisor'), deps);
}

function registerVisitor(namespace: Namespace, deps: RealtimeDeps): void {
  namespace.use(async (socket, next) => {
    try {
      const principal = await deps.sessions.authenticateVisitor(readHandshakeToken(socket));
      if (!principal) {
        next(new Error('unauthorized'));
        return;
      }
      socket.data.principal = principal;
      next();
    } catch {
      next(new Error('unauthorized'));
    }
  });

  namespace.on('connection', (socket) => {
    const principal = socket.data.principal as VisitorPrincipal;
    const sessionReady = joinSessionRoom(socket, principal, () => deps.sessions.isSessionActive(principal));
    void afterSessionValidation(socket, sessionReady, async () => {
      const conversation = await deps.conversations.openConversation(principal);
      if (conversation && socket.connected) socket.join(rooms.conversation(principal.tenantId, conversation.id));
    }).catch((error: unknown) => {
      deps.logger.error({ err: error }, 'falha ao entrar na conversa aberta');
    });

    bindSocket(socket, asSchemas(visitorClientSchemas), {
      'queue.list': async () => {
        const context = await deps.sessions.visitorContext(principal);
        return { queues: context.queues };
      },
      'conversation.start': async (payload) => {
        const input = conversationStartSchema.parse(payload);
        const result = await deps.conversations.start(principal, input.queueId, input.displayName);
        socket.join(rooms.conversation(principal.tenantId, result.conversation.id));
        if (result.created) {
          await safeNotify(deps.logger, 'queued', () =>
            deps.sm.onConversationQueued({
              tenantId: principal.tenantId,
              conversationId: result.conversation.id,
              siteId: principal.siteId,
              queueId: result.conversation.queueId,
            }),
          );
          deps.hub.conversationUpdated(principal.tenantId, result.conversation, null);
        }
        publishPositions(deps, principal.tenantId, result.positions);
        return {
          created: result.created,
          conversation: result.conversation,
          messages: result.messages,
          survey: result.survey,
        };
      },
      'conversation.leave': async (payload) => {
        const input = conversationActionSchema.parse(payload);
        const result = await deps.conversations.leave(principal, input.conversationId);
        deps.hub.conversationUpdated(principal.tenantId, result.conversation, null);
        publishPositions(deps, principal.tenantId, result.positions);
        return { conversation: result.conversation };
      },
      'message.send': (payload) => sendMessage(socket, deps, principal, payload),
      'history.sync': async (payload) => {
        const input = historySyncSchema.parse(payload);
        const result = await deps.conversations.history(principal, input.conversationId, {
          ...(input.afterMessageId ? { afterMessageId: input.afterMessageId } : {}),
          ...(input.afterEventId ? { afterEventId: input.afterEventId } : {}),
        });
        socket.join(rooms.conversation(principal.tenantId, input.conversationId));
        return result;
      },
      'survey.submit': async (payload) => {
        const input = surveySubmitSchema.parse(payload);
        const conversation = await deps.conversations.submitSurvey(principal, {
          conversationId: input.conversationId,
          score: input.score,
          ...(input.comment ? { comment: input.comment } : {}),
        });
        deps.hub.conversationUpdated(principal.tenantId, conversation, null);
        return { conversation };
      },
    }, deps.logger);
  });
}

function registerAgent(namespace: Namespace, deps: RealtimeDeps): void {
  namespace.use(async (socket, next) => {
    try {
      const principal = await deps.sessions.authenticateAgent(readHandshakeToken(socket));
      if (!principal || principal.kind !== 'agent') {
        next(new Error('unauthorized'));
        return;
      }
      socket.data.principal = principal;
      next();
    } catch {
      next(new Error('unauthorized'));
    }
  });

  namespace.on('connection', (socket) => {
    const principal = socket.data.principal as AgentPrincipal;
    const sessionReady = joinSessionRoom(socket, principal, () => deps.sessions.isSessionActive(principal));
    const ready = afterSessionValidation(socket, sessionReady, async () => {
      socket.join(rooms.agent(principal.tenantId, principal.agentId));
      await prepareAgent(socket, principal, deps);
      if (socket.connected) await joinOwnRooms(deps.internalChat, socket, principal);
    });
    socket.on('disconnect', () => {
      void ready
        .catch(() => undefined)
        .then(async () => {
          const change = await deps.presence.disconnect(principal, socket.id);
          if (change.previous === change.next.status) return;
          deps.hub.presenceUpdated(
            principal.tenantId,
            principal.agentId,
            change.next.queueIds,
            change.next.status,
          );
        })
        .catch((error: unknown) => {
          deps.logger.error({ err: error }, 'falha ao encerrar presença do agente');
        });
    });

    bindSocket(socket, asSchemas(agentClientSchemas), {
      'queue.subscribe': async () => {
        await ready;
        return { conversations: await deps.conversations.listForAgent(principal) };
      },
      'conversation.claim': async (payload) => {
        await ready;
        const input = conversationActionSchema.parse(payload);
        const result = await deps.conversations.claim(principal, input.conversationId);
        await safeNotify(deps.logger, 'assigned', () =>
          deps.sm.onConversationAssigned({
            tenantId: principal.tenantId,
            conversationId: result.conversation.id,
            siteId: result.siteId,
            queueId: result.conversation.queueId,
            agentId: principal.agentId,
          }),
        );
        deps.hub.conversationUpdated(principal.tenantId, result.conversation, null);
        publishPositions(deps, principal.tenantId, result.positions);
        await publishAgentPresence(deps, principal.tenantId, principal.agentId);
        return { conversation: result.conversation };
      },
      'conversation.release': async (payload) => {
        await ready;
        const input = conversationActionSchema.parse(payload);
        const result = await deps.conversations.release(principal, input.conversationId);
        await safeNotify(deps.logger, 'released', () =>
          deps.sm.onConversationReleased({
            tenantId: principal.tenantId,
            conversationId: result.conversation.id,
            siteId: result.siteId,
            queueId: result.conversation.queueId,
            agentId: principal.agentId,
          }),
        );
        deps.hub.conversationUpdated(principal.tenantId, result.conversation, null);
        publishPositions(deps, principal.tenantId, result.positions);
        await publishAgentPresence(deps, principal.tenantId, principal.agentId);
        return { conversation: result.conversation };
      },
      'message.send': async (payload) => {
        await ready;
        return sendMessage(socket, deps, principal, payload);
      },
      'conversation.transfer': async (payload) => {
        await ready;
        return transfer(deps, principal, payload);
      },
      'conversation.close': async (payload) => {
        await ready;
        const input = conversationCloseSchema.parse(payload);
        const result = await deps.conversations.close(principal, input.conversationId, input.dispositionId);
        if (result.applied) {
          await safeNotify(deps.logger, 'closed', () =>
            deps.sm.onConversationClosed({
              tenantId: principal.tenantId,
              conversationId: result.conversation.id,
              siteId: result.siteId,
              queueId: result.conversation.queueId,
              agentId: principal.agentId,
              dispositionId: input.dispositionId,
            }),
          );
          deps.hub.conversationUpdated(principal.tenantId, result.conversation, null);
          deps.hub.surveyRequired(
            principal.tenantId,
            result.conversation.id,
            result.survey,
            principal.agentId,
            result.conversation.queueId,
          );
          await publishAgentPresence(deps, principal.tenantId, principal.agentId);
        }
        return { conversation: result.conversation, survey: result.survey };
      },
      'history.sync': async (payload) => {
        await ready;
        return syncHistory(deps, principal, payload);
      },
      'presence.set': async (payload) => {
        await ready;
        const input = presenceSetSchema.parse(payload);
        const presence = await deps.presence.setDesired(principal, input.status);
        deps.hub.presenceUpdated(principal.tenantId, principal.agentId, presence.queueIds, presence.status);
        return { status: presence.status };
      },
      'presence.heartbeat': async () => {
        await ready;
        const change = await deps.presence.heartbeat(principal, socket.id);
        if (change.previous !== change.next.status) {
          deps.hub.presenceUpdated(
            principal.tenantId,
            principal.agentId,
            change.next.queueIds,
            change.next.status,
          );
        }
        return { status: change.next.status };
      },
      'message.read': async (payload) => {
        await ready;
        const input = messageReadCommandSchema.parse(payload);
        const result = await deps.conversations.markRead(principal, input.conversationId, input.messageId);
        if (result.advanced) {
          const queueId = await deps.conversations.queueIdForConversation(principal, input.conversationId);
          deps.hub.messageRead(principal.tenantId, {
            conversationId: input.conversationId,
            agentId: principal.agentId,
            messageId: input.messageId,
          }, queueId);
        }
        return {
          conversationId: input.conversationId,
          messageId: input.messageId,
          advanced: result.advanced,
        };
      },
      ...staffHandlers(staffDeps(deps), socket, principal, ready),
    }, deps.logger);
  });
}

function registerSupervisor(namespace: Namespace, deps: RealtimeDeps): void {
  namespace.use(async (socket, next) => {
    try {
      const principal = await deps.sessions.authenticateAgent(readHandshakeToken(socket));
      if (!principal || !isStaff(principal.kind)) {
        next(new Error('unauthorized'));
        return;
      }
      socket.data.principal = principal;
      next();
    } catch {
      next(new Error('unauthorized'));
    }
  });

  namespace.on('connection', (socket) => {
    const principal = socket.data.principal as AgentPrincipal;
    const sessionReady = joinSessionRoom(socket, principal, () => deps.sessions.isSessionActive(principal));
    const ready = afterSessionValidation(socket, sessionReady, async () => {
      if (principal.kind === 'admin') {
        socket.join(rooms.supervisors(principal.tenantId));
      } else {
        const queueIds = await deps.conversations.queueIdsForSupervisor(principal);
        for (const queueId of queueIds) socket.join(rooms.supervisorQueue(principal.tenantId, queueId));
      }
      socket.join(rooms.agent(principal.tenantId, principal.agentId));
      await prepareStaff(socket, principal, deps);
      if (socket.connected) await joinOwnRooms(deps.internalChat, socket, principal);
    }).catch((error: unknown) => {
      deps.logger.error({ err: error }, 'falha ao preparar socket do supervisor');
      socket.disconnect(true);
    });
    socket.on('disconnect', () => {
      void ready
        .catch(() => undefined)
        .then(async () => {
          const change = await deps.presence.disconnect(principal, socket.id);
          if (change.previous === change.next.status) return;
          deps.hub.presenceUpdated(
            principal.tenantId,
            principal.agentId,
            change.next.queueIds,
            change.next.status,
          );
        })
        .catch((error: unknown) => {
          deps.logger.error({ err: error }, 'falha ao encerrar presença do supervisor');
        });
    });
    bindSocket(socket, asSchemas(supervisorClientSchemas), {
      'conversation.list': async () => {
        await ready;
        return { conversations: await deps.conversations.listForSupervisor(principal) };
      },
      'conversation.watch': async (payload) => {
        await ready;
        const input = conversationActionSchema.parse(payload);
        return deps.conversations.history(principal, input.conversationId, {}, 'conversation.watch');
      },
      'conversation.transfer': async (payload) => {
        await ready;
        return transfer(deps, principal, payload);
      },
      'history.sync': async (payload) => {
        await ready;
        return syncHistory(deps, principal, payload);
      },
      'presence.heartbeat': async () => {
        await ready;
        const change = await deps.presence.heartbeat(principal, socket.id);
        if (change.previous !== change.next.status) {
          deps.hub.presenceUpdated(
            principal.tenantId,
            principal.agentId,
            change.next.queueIds,
            change.next.status,
          );
        }
        return { status: change.next.status };
      },
      ...staffHandlers(staffDeps(deps), socket, principal, ready),
    }, deps.logger);
  });
}

async function sendMessage(
  _socket: Socket,
  deps: RealtimeDeps,
  principal: VisitorPrincipal | AgentPrincipal,
  payload: unknown,
): Promise<object> {
  const input = messageSendSchema.parse(payload);
  if (!deps.limiter.allow(`message:${principal.sessionId}`, deps.messageLimit)) {
    throw new DomainError('rate_limited', 'Muitas mensagens. Tente novamente.');
  }
  const result = await deps.messages.send(principal, input);
  if (result.created) {
    deps.hub.messageCreated(principal.tenantId, result.message, {
      queueId: result.queueId,
      status: result.status,
      agentId: result.agentId,
    });
  }
  return {
    requestId: result.message.requestId,
    messageId: result.message.id,
    created: result.created,
  };
}

async function transfer(deps: RealtimeDeps, principal: AgentPrincipal, payload: unknown): Promise<object> {
  const input = conversationTransferSchema.parse(payload);
  const result = await deps.conversations.transfer(principal, input.conversationId, input.queueId);
  await safeNotify(deps.logger, 'transferred', () =>
    deps.sm.onConversationTransferred({
      tenantId: principal.tenantId,
      conversationId: result.conversation.id,
      siteId: result.siteId,
      queueId: result.conversation.queueId,
      fromQueueId: result.previousQueueId,
      agentId: principal.agentId,
    }),
  );
  deps.hub.conversationUpdated(principal.tenantId, result.conversation, result.previousQueueId);
  publishPositions(deps, principal.tenantId, result.positions);
  if (result.releasedAgentId) {
    await publishAgentPresence(deps, principal.tenantId, result.releasedAgentId);
  }
  return { conversation: result.conversation satisfies ConversationSummary };
}

function staffDeps(deps: RealtimeDeps): StaffDeps {
  return {
    conversations: deps.conversations,
    sectors: deps.sectors,
    internalChat: deps.internalChat,
    announcements: deps.announcements,
    activities: deps.activities,
    supervisor: deps.supervisor,
    hub: deps.hub,
    limiter: deps.limiter,
    messageLimit: deps.messageLimit,
  };
}

async function prepareStaff(socket: Socket, principal: AgentPrincipal, deps: RealtimeDeps): Promise<void> {
  await deps.presence.connect(principal, socket.id);
  if (!socket.connected) {
    await deps.presence.disconnect(principal, socket.id);
    return;
  }
  await publishAgentPresence(deps, principal.tenantId, principal.agentId);
}

async function prepareAgent(socket: Socket, principal: AgentPrincipal, deps: RealtimeDeps): Promise<void> {
  await deps.presence.connect(principal, socket.id);
  if (!socket.connected) {
    await deps.presence.disconnect(principal, socket.id);
    return;
  }
  const queueIds = await deps.conversations.queueIdsForAgent(principal);
  if (!socket.connected) {
    await deps.presence.disconnect(principal, socket.id);
    return;
  }
  socket.data.queueIds = queueIds;
  for (const queueId of queueIds) socket.join(rooms.queue(principal.tenantId, queueId));
  await publishAgentPresence(deps, principal.tenantId, principal.agentId);
}

async function publishAgentPresence(deps: RealtimeDeps, tenantId: string, agentId: string): Promise<void> {
  const presence = await deps.presence.effectiveById(tenantId, agentId);
  deps.hub.presenceUpdated(tenantId, agentId, presence.queueIds, presence.status);
}

function syncHistory(deps: RealtimeDeps, principal: VisitorPrincipal | AgentPrincipal, payload: unknown) {
  const input = historySyncSchema.parse(payload);
  return deps.conversations.history(principal, input.conversationId, {
    ...(input.afterMessageId ? { afterMessageId: input.afterMessageId } : {}),
    ...(input.afterEventId ? { afterEventId: input.afterEventId } : {}),
  });
}

function publishPositions(deps: RealtimeDeps, tenantId: string, positions: QueuePosition[]): void {
  for (const position of positions) deps.hub.queuePosition(tenantId, position);
}

function asSchemas(schemas: object): Record<string, ZodType> {
  return schemas as Record<string, ZodType>;
}
