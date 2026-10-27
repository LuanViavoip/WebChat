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

  conversationUpdated(tenantId: string, summary: ConversationSummary, previousQueueId: string | null): void {
    this.io.of('/visitor').to(rooms.conversation(tenantId, summary.id)).emit('conversation.updated', summary);
    this.io.of('/agent').to(rooms.queue(tenantId, summary.queueId)).emit('conversation.updated', summary);
    if (previousQueueId && previousQueueId !== summary.queueId) {
      this.io.of('/agent').to(rooms.queue(tenantId, previousQueueId)).emit('conversation.updated', summary);
    }
    if (summary.agentId) {
      this.io.of('/agent').to(rooms.agent(tenantId, summary.agentId)).emit('conversation.updated', summary);
    }
    this.io.of('/supervisor').to(rooms.supervisors(tenantId)).emit('conversation.updated', summary);
    this.touch(tenantId);
  }

  messageCreated(tenantId: string, message: MessageRecord, context: MessageContext): void {
    this.io.of('/visitor').to(rooms.conversation(tenantId, message.conversationId)).emit('message.new', message);
    if (context.status === 'queued') {
      this.io.of('/agent').to(rooms.queue(tenantId, context.queueId)).emit('message.new', message);
    } else if (context.agentId) {
      this.io.of('/agent').to(rooms.agent(tenantId, context.agentId)).emit('message.new', message);
    }
    this.io.of('/supervisor').to(rooms.supervisors(tenantId)).emit('message.new', message);
  }

  queuePosition(tenantId: string, position: QueuePosition): void {
    const payload = queuePositionSchema.parse(position);
    this.io.of('/visitor').to(rooms.conversation(tenantId, payload.conversationId)).emit('queue.position', payload);
    this.io.of('/agent').to(rooms.queue(tenantId, payload.queueId)).emit('queue.position', payload);
    this.io.of('/supervisor').to(rooms.supervisors(tenantId)).emit('queue.position', payload);
  }

  presenceUpdated(tenantId: string, agentId: string, queueIds: string[], status: PresenceUpdated['status']): void {
    const payload = presenceUpdatedSchema.parse({ agentId, status });
    let broadcast = this.io.of('/agent').to(rooms.agent(tenantId, agentId));
    for (const queueId of queueIds) broadcast = broadcast.to(rooms.queue(tenantId, queueId));
    broadcast.emit('presence.updated', payload);
    this.io.of('/supervisor').to(rooms.supervisors(tenantId)).emit('presence.updated', payload);
    this.touch(tenantId);
  }

  messageRead(tenantId: string, read: MessageRead): void {
    const payload = messageReadSchema.parse(read);
    this.io.of('/agent').to(rooms.agent(tenantId, payload.agentId)).emit('message.read', payload);
    this.io.of('/supervisor').to(rooms.supervisors(tenantId)).emit('message.read', payload);
  }

  surveyRequired(
    tenantId: string,
    conversationId: string,
    survey: SurveyPrompt,
    agentId: string | null,
  ): void {
    const payload = { conversationId, survey };
    this.io.of('/visitor').to(rooms.conversation(tenantId, conversationId)).emit('survey.required', payload);
    if (agentId) this.io.of('/agent').to(rooms.agent(tenantId, agentId)).emit('survey.required', payload);
    this.io.of('/supervisor').to(rooms.supervisors(tenantId)).emit('survey.required', payload);
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

  internalMessage(tenantId: string, message: InternalMessage): void {
    const payload = internalMessageSchema.parse(message);
    const room = rooms.internal(tenantId, payload.conversationId);
    for (const namespace of staffNamespaces) {
      this.io.of(namespace).to(room).emit('internal.message.new', payload);
    }
  }

  internalRead(tenantId: string, read: MessageRead): void {
    const payload = messageReadSchema.parse(read);
    const room = rooms.internal(tenantId, payload.conversationId);
    for (const namespace of staffNamespaces) {
      this.io.of(namespace).to(room).emit('internal.message.read', payload);
    }
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
}
