import type {
  ActivityAssignment,
  Announcement,
  ConversationStatus,
  ConversationSummary,
  InternalConversation,
  InternalMessage,
  MessageRead,
  MessageRecord,
  PresenceUpdated,
  QueuePosition,
  SectorSummary,
  SurveyPrompt,
} from '@viavoip/protocol';
import {
  activityAssignmentSchema,
  announcementSchema,
  internalConversationSchema,
  internalMessageSchema,
  messageReadSchema,
  presenceUpdatedSchema,
  queuePositionSchema,
  sectorSummarySchema,
} from '@viavoip/protocol';
import type { Server } from 'socket.io';
import type { AgentPrincipal } from '../domain/types.js';
import { rooms } from './rooms.js';

export type MessageContext = {
  queueId: string;
  status: ConversationStatus;
  agentId: string | null;
};

const staffNamespaces = ['/agent', '/supervisor'] as const;

export class SocketHub {
  private onChange: (tenantId: string) => void = () => undefined;

  constructor(private readonly io: Server) {}

  setChangeListener(listener: (tenantId: string) => void): void {
    this.onChange = listener;
  }

  touch(tenantId: string): void {
    this.onChange(tenantId);
  }

  private supervisorQueues(tenantId: string, queueIds: string[]) {
    let target = this.io.of('/supervisor').to(rooms.supervisors(tenantId));
    for (const queueId of new Set(queueIds)) target = target.to(rooms.supervisorQueue(tenantId, queueId));
    return target;
  }

  conversationUpdated(tenantId: string, summary: ConversationSummary, previousQueueId: string | null): void {
    this.io.of('/visitor').to(rooms.conversation(tenantId, summary.id)).emit('conversation.updated', summary);
    this.io.of('/agent').to(rooms.queue(tenantId, summary.queueId)).emit('conversation.updated', summary);
    if (previousQueueId && previousQueueId !== summary.queueId) {
      this.io.of('/agent').to(rooms.queue(tenantId, previousQueueId)).emit('conversation.updated', summary);
    }
    if (summary.agentId) {
      this.io.of('/agent').to(rooms.agent(tenantId, summary.agentId)).emit('conversation.updated', summary);
    }
    this.supervisorQueues(tenantId, [summary.queueId]).emit('conversation.updated', summary);
    this.touch(tenantId);
  }

  messageCreated(tenantId: string, message: MessageRecord, context: MessageContext): void {
    this.io.of('/visitor').to(rooms.conversation(tenantId, message.conversationId)).emit('message.new', message);
    if (context.status === 'queued') {
      this.io.of('/agent').to(rooms.queue(tenantId, context.queueId)).emit('message.new', message);
    } else if (context.agentId) {
      this.io.of('/agent').to(rooms.agent(tenantId, context.agentId)).emit('message.new', message);
    }
    this.supervisorQueues(tenantId, [context.queueId]).emit('message.new', message);
  }

  queuePosition(tenantId: string, position: QueuePosition): void {
    const payload = queuePositionSchema.parse(position);
    this.io.of('/visitor').to(rooms.conversation(tenantId, payload.conversationId)).emit('queue.position', payload);
    this.io.of('/agent').to(rooms.queue(tenantId, payload.queueId)).emit('queue.position', payload);
    this.supervisorQueues(tenantId, [payload.queueId]).emit('queue.position', payload);
  }

  presenceUpdated(tenantId: string, agentId: string, queueIds: string[], status: PresenceUpdated['status']): void {
    const payload = presenceUpdatedSchema.parse({ agentId, status });
    let broadcast = this.io.of('/agent').to(rooms.agent(tenantId, agentId));
    for (const queueId of queueIds) broadcast = broadcast.to(rooms.queue(tenantId, queueId));
    broadcast.emit('presence.updated', payload);
    // Supervisor snapshots apply sector membership before exposing agent presence.
    this.touch(tenantId);
  }

  messageRead(tenantId: string, read: MessageRead, queueId: string): void {
    const payload = messageReadSchema.parse(read);
    this.io.of('/agent').to(rooms.agent(tenantId, payload.agentId)).emit('message.read', payload);
    this.supervisorQueues(tenantId, [queueId]).emit('message.read', payload);
  }

  surveyRequired(
    tenantId: string,
    conversationId: string,
    survey: SurveyPrompt,
    agentId: string | null,
    queueId: string,
  ): void {
    const payload = { conversationId, survey };
    this.io.of('/visitor').to(rooms.conversation(tenantId, conversationId)).emit('survey.required', payload);
    if (agentId) this.io.of('/agent').to(rooms.agent(tenantId, agentId)).emit('survey.required', payload);
    this.supervisorQueues(tenantId, [queueId]).emit('survey.required', payload);
  }

  emitToPeople(tenantId: string, agentIds: string[], event: string, payload: unknown): void {
    for (const agentId of new Set(agentIds)) {
      const room = rooms.agent(tenantId, agentId);
      for (const namespace of staffNamespaces) {
        this.io.of(namespace).to(room).emit(event, payload);
      }
    }
  }

  sectorUpdated(tenantId: string, agentIds: string[], sector: SectorSummary): void {
    this.emitToPeople(tenantId, agentIds, 'sector.updated', sectorSummarySchema.parse(sector));
  }

  internalConversationUpdated(tenantId: string, agentIds: string[], conversation: InternalConversation): void {
    this.emitToPeople(
      tenantId,
      agentIds,
      'internal.conversation.updated',
      internalConversationSchema.parse(conversation),
    );
  }

  internalMessage(tenantId: string, message: InternalMessage, agentIds: string[]): void {
    const payload = internalMessageSchema.parse(message);
    this.emitToPeople(tenantId, agentIds, 'internal.message.new', payload);
  }

  internalRead(tenantId: string, read: MessageRead, agentIds: string[]): void {
    const payload = messageReadSchema.parse(read);
    this.emitToPeople(tenantId, agentIds, 'internal.message.read', payload);
  }

  announcementPublished(tenantId: string, agentIds: string[], announcement: Announcement, updated: boolean): void {
    this.emitToPeople(
      tenantId,
      agentIds,
      updated ? 'announcement.updated' : 'announcement.published',
      announcementSchema.parse(announcement),
    );
  }

  activityUpdated(tenantId: string, agentIds: string[], assignment: ActivityAssignment): void {
    this.emitToPeople(tenantId, agentIds, 'activity.updated', activityAssignmentSchema.parse(assignment));
    this.touch(tenantId);
  }

  async movePeople(
    tenantId: string,
    agentIds: string[],
    conversationId: string,
    sectorId: string | null,
    action: 'join' | 'leave',
  ): Promise<void> {
    const conversationRoom = rooms.internal(tenantId, conversationId);
    const sectorRoom = sectorId ? rooms.sector(tenantId, sectorId) : null;
    for (const namespace of staffNamespaces) {
      for (const agentId of new Set(agentIds)) {
        const sockets = await this.io.of(namespace).in(rooms.agent(tenantId, agentId)).fetchSockets();
        for (const socket of sockets) {
          if (action === 'join') {
            socket.join(conversationRoom);
            if (sectorRoom) socket.join(sectorRoom);
          } else {
            socket.leave(conversationRoom);
            if (sectorRoom) socket.leave(sectorRoom);
          }
        }
      }
    }
  }

  async reconcileInternalRoom(
    tenantId: string,
    conversationId: string,
    activeAgentIds: string[],
    getActiveAgentIds: () => Promise<string[]>,
  ): Promise<void> {
    const conversationRoom = rooms.internal(tenantId, conversationId);
    const active = new Set(activeAgentIds);
    for (const namespace of staffNamespaces) {
      const current = await this.io.of(namespace).in(conversationRoom).fetchSockets();
      for (const socket of current) {
        const principal = socket.data.principal as { agentId?: string } | undefined;
        if (!principal?.agentId || !active.has(principal.agentId)) socket.leave(conversationRoom);
      }
      for (const agentId of active) {
        const sockets = await this.io.of(namespace).in(rooms.agent(tenantId, agentId)).fetchSockets();
        for (const socket of sockets) socket.join(conversationRoom);
      }
      const verified = new Set(await getActiveAgentIds());
      const refreshed = await this.io.of(namespace).in(conversationRoom).fetchSockets();
      for (const socket of refreshed) {
        const principal = socket.data.principal as { agentId?: string } | undefined;
        if (!principal?.agentId || !verified.has(principal.agentId)) socket.leave(conversationRoom);
      }
    }
  }

  async reconcileSupervisorQueues(
    tenantId: string,
    getQueueIds: (principal: AgentPrincipal) => Promise<string[]>,
  ): Promise<void> {
    const prefix = `tenant:${tenantId}:supervisors:queue:`;
    const sockets = await this.io.of('/supervisor').fetchSockets();
    for (const socket of sockets) {
      const principal = socket.data.principal as AgentPrincipal | undefined;
      if (!principal || principal.tenantId !== tenantId || principal.kind === 'admin') continue;
      for (const room of socket.rooms) if (room.startsWith(prefix)) socket.leave(room);
      for (const queueId of await getQueueIds(principal)) socket.join(rooms.supervisorQueue(tenantId, queueId));
    }
  }
}
