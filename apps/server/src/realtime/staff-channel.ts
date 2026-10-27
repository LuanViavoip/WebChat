import {
  activityAgentSchema,
  activityAssignSchema,
  activityHistorySchema,
  activityTypeSaveSchema,
  announcementIdSchema,
  announcementListSchema,
  announcementPublishSchema,
  announcementUpdateSchema,
  internalHistorySchema,
  internalOpenSchema,
  messageReadCommandSchema,
  messageSendSchema,
  sectorMemberChangeSchema,
  sectorSaveSchema,
  supervisorSnapshotCommandSchema,
} from '@viavoip/protocol';
import type { Socket } from 'socket.io';
import { DomainError } from '../domain/errors.js';
import type { AgentPrincipal } from '../domain/types.js';
import type { ActivityService } from '../modules/activities.js';
import type { AnnouncementService } from '../modules/announcements.js';
import type { InternalChatService } from '../modules/internal-chat.js';
import type { ConversationService } from '../modules/conversations.js';
import type { SectorService } from '../modules/sectors.js';
import type { SupervisorService } from '../modules/supervisor.js';
import type { SlidingWindowLimiter } from '../http/rate-limit.js';
import type { SocketHub } from './hub.js';
import { rooms } from './rooms.js';

export type StaffDeps = {
  conversations: ConversationService;
  sectors: SectorService;
  internalChat: InternalChatService;
  announcements: AnnouncementService;
  activities: ActivityService;
  supervisor: SupervisorService;
  hub: SocketHub;
  limiter: SlidingWindowLimiter;
  messageLimit: number;
};

export async function joinOwnRooms(internalChat: InternalChatService, socket: Socket, principal: AgentPrincipal): Promise<void> {
  if (!socket.connected) return;
  const membership = await internalChat.roomsFor(principal);
  for (const conversationId of membership.conversationIds) {
    socket.join(rooms.internal(principal.tenantId, conversationId));
  }
  for (const sectorId of membership.sectorIds) socket.join(rooms.sector(principal.tenantId, sectorId));
  // A membership may have been revoked while the first query was in flight.
  const current = await internalChat.roomsFor(principal);
  const currentConversationIds = new Set(current.conversationIds);
  for (const conversationId of membership.conversationIds) {
    if (!currentConversationIds.has(conversationId)) socket.leave(rooms.internal(principal.tenantId, conversationId));
  }
}

export function staffHandlers(deps: StaffDeps, socket: Socket, principal: AgentPrincipal, ready: Promise<void>) {
  const run = async <T>(work: () => Promise<T>): Promise<T> => {
    await ready;
    return work();
  };

  return {
    'sector.list': () => run(async () => ({ sectors: await deps.sectors.list(principal) })),
    'sector.save': (payload: unknown) =>
      run(async () => {
        const input = sectorSaveSchema.parse(payload);
        const result = await deps.sectors.save(principal, {
          name: input.name,
          ...(input.sectorId ? { sectorId: input.sectorId } : {}),
          ...(input.description !== undefined ? { description: input.description } : {}),
          ...(input.active !== undefined ? { active: input.active } : {}),
          ...(input.supervisorIds ? { supervisorIds: input.supervisorIds } : {}),
        });
        await deps.hub.reconcileSupervisorQueues(
          principal.tenantId,
          (supervisorPrincipal) => deps.conversations.queueIdsForSupervisor(supervisorPrincipal),
        );
        await reconcileSectorRooms(deps, principal.tenantId, result.conversationId);
        deps.hub.sectorUpdated(principal.tenantId, result.notifyAgentIds, result.sector);
        const conversation = await deps.internalChat.summarize(principal, result.conversationId);
        deps.hub.internalConversationUpdated(principal.tenantId, result.notifyAgentIds, conversation);
        deps.hub.touch(principal.tenantId);
        return { sector: result.sector };
      }),
    'sector.member.add': (payload: unknown) =>
      run(async () => {
        const input = sectorMemberChangeSchema.parse(payload);
        const result = await deps.sectors.addMember(principal, input.sectorId, input.agentId);
        await reconcileSectorRooms(deps, principal.tenantId, result.conversationId);
        deps.hub.sectorUpdated(principal.tenantId, result.notifyAgentIds, result.sector);
        const conversation = await deps.internalChat.summarize(principal, result.conversationId);
        deps.hub.internalConversationUpdated(principal.tenantId, result.notifyAgentIds, conversation);
        return { sector: result.sector };
      }),
    'sector.member.remove': (payload: unknown) =>
      run(async () => {
        const input = sectorMemberChangeSchema.parse(payload);
        const result = await deps.sectors.removeMember(principal, input.sectorId, input.agentId);
        await reconcileSectorRooms(deps, principal.tenantId, result.conversationId);
        const audience = [...new Set([...result.notifyAgentIds, input.agentId])];
        deps.hub.sectorUpdated(principal.tenantId, audience, result.sector);
        return { sector: result.sector };
      }),
    'internal.list': () => run(async () => ({ conversations: await deps.internalChat.list(principal) })),
    'internal.open': (payload: unknown) =>
      run(async () => {
        const input = internalOpenSchema.parse(payload);
        const result = await deps.internalChat.open(principal, input.peerId);
        socket.join(rooms.internal(principal.tenantId, result.conversation.id));
        await deps.hub.movePeople(
          principal.tenantId,
          [principal.agentId, input.peerId],
          result.conversation.id,
          null,
          'join',
        );
        deps.hub.internalConversationUpdated(
          principal.tenantId,
          [principal.agentId, input.peerId],
          result.conversation,
        );
        return { created: result.created, conversation: result.conversation };
      }),
    'internal.message.send': (payload: unknown) =>
      run(async () => {
        const input = messageSendSchema.parse(payload);
        if (!deps.limiter.allow(`internal:${principal.sessionId}`, deps.messageLimit)) {
          throw new DomainError('rate_limited', 'Muitas mensagens. Tente novamente.');
        }
        const result = await deps.internalChat.send(principal, input);
        if (result.created) deps.hub.internalMessage(principal.tenantId, result.message);
        return { requestId: result.message.requestId, messageId: result.message.id, created: result.created };
      }),
    'internal.history': (payload: unknown) =>
      run(async () => {
        const input = internalHistorySchema.parse(payload);
        const messages = await deps.internalChat.history(principal, {
          conversationId: input.conversationId,
          ...(input.beforeMessageId ? { beforeMessageId: input.beforeMessageId } : {}),
          ...(input.afterMessageId ? { afterMessageId: input.afterMessageId } : {}),
          ...(input.limit ? { limit: input.limit } : {}),
        });
        return { messages };
      }),
    'internal.message.read': (payload: unknown) =>
      run(async () => {
        const input = messageReadCommandSchema.parse(payload);
        const result = await deps.internalChat.markRead(principal, input.conversationId, input.messageId);
        if (result.advanced) {
          deps.hub.internalRead(principal.tenantId, {
            conversationId: input.conversationId,
            agentId: principal.agentId,
            messageId: input.messageId,
          });
        }
        return { conversationId: input.conversationId, messageId: input.messageId, advanced: result.advanced };
      }),
    'announcement.list': (payload: unknown) =>
      run(async () => {
        const input = announcementListSchema.parse(payload);
        return { announcements: await deps.announcements.list(principal, input.includeArchived ?? false) };
      }),
    'announcement.publish': (payload: unknown) =>
      run(async () => {
        const input = announcementPublishSchema.parse(payload);
        const result = await deps.announcements.publish(principal, {
          title: input.title,
          body: input.body,
          audience: input.audience,
          ...(input.pinned !== undefined ? { pinned: input.pinned } : {}),
          ...(input.sectorIds ? { sectorIds: input.sectorIds } : {}),
          ...(input.expiresAt !== undefined ? { expiresAt: input.expiresAt } : {}),
        });
        deps.hub.announcementPublished(principal.tenantId, result.notifyAgentIds, result.announcement, false);
        return { announcement: result.announcement };
      }),
    'announcement.update': (payload: unknown) =>
      run(async () => {
        const input = announcementUpdateSchema.parse(payload);
        const result = await deps.announcements.update(principal, {
          announcementId: input.announcementId,
          title: input.title,
          body: input.body,
          ...(input.pinned !== undefined ? { pinned: input.pinned } : {}),
          ...(input.expiresAt !== undefined ? { expiresAt: input.expiresAt } : {}),
        });
        deps.hub.announcementPublished(principal.tenantId, result.notifyAgentIds, result.announcement, true);
        return { announcement: result.announcement };
      }),
    'announcement.archive': (payload: unknown) =>
      run(async () => {
        const input = announcementIdSchema.parse(payload);
        const result = await deps.announcements.archive(principal, input.announcementId);
        deps.hub.announcementPublished(principal.tenantId, result.notifyAgentIds, result.announcement, true);
        return { announcement: result.announcement };
      }),
    'announcement.read': (payload: unknown) =>
      run(async () => {
        const input = announcementIdSchema.parse(payload);
        return { announcement: await deps.announcements.markRead(principal, input.announcementId) };
      }),
    'activity.catalog': () => run(() => deps.activities.catalog(principal)),
    'activity.type.save': (payload: unknown) =>
      run(async () => {
        const input = activityTypeSaveSchema.parse(payload);
        const activityType = await deps.activities.saveType(principal, {
          name: input.name,
          ...(input.activityTypeId ? { activityTypeId: input.activityTypeId } : {}),
          ...(input.active !== undefined ? { active: input.active } : {}),
        });
        return { activityType };
      }),
    'activity.assign': (payload: unknown) =>
      run(async () => {
        const input = activityAssignSchema.parse(payload);
        const result = await deps.activities.assign(principal, input.agentId, input.activityTypeId);
        deps.hub.activityUpdated(principal.tenantId, result.notifyAgentIds, result.assignment);
        return { assignment: result.assignment };
      }),
    'activity.finish': (payload: unknown) =>
      run(async () => {
        const input = activityAgentSchema.parse(payload);
        const result = await deps.activities.finish(principal, input.agentId);
        deps.hub.activityUpdated(principal.tenantId, result.notifyAgentIds, result.assignment);
        return { assignment: result.assignment };
      }),
    'activity.history': (payload: unknown) =>
      run(async () => {
        const input = activityHistorySchema.parse(payload);
        return { assignments: await deps.activities.history(principal, input.agentId) };
      }),
    'supervisor.snapshot': (payload: unknown) =>
      run(async () => {
        const input = supervisorSnapshotCommandSchema.parse(payload);
        const snapshot = await deps.supervisor.snapshot(principal, {
          ...(input.from ? { from: input.from } : {}),
          ...(input.to ? { to: input.to } : {}),
        });
        return { snapshot };
      }),
  };
}

async function reconcileSectorRooms(
  deps: StaffDeps,
  tenantId: string,
  conversationId: string,
): Promise<void> {
  const participants = await deps.internalChat.activeParticipants(conversationId, tenantId);
  await deps.hub.reconcileInternalRoom(
    tenantId,
    conversationId,
    participants,
    () => deps.internalChat.activeParticipants(conversationId, tenantId),
  );
}
