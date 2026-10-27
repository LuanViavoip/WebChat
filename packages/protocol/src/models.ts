import { z } from 'zod';

export const roleSchema = z.enum(['agent', 'supervisor', 'admin']);

export const conversationStatusSchema = z.enum([
  'queued',
  'assigned',
  'awaiting_survey',
  'closed',
]);

export const queueSummarySchema = z
  .object({
    id: z.string().uuid(),
    name: z.string().min(1).max(120),
  })
  .strict();

export const dispositionSummarySchema = z
  .object({
    id: z.string().uuid(),
    name: z.string().min(1).max(120),
  })
  .strict();

export const conversationSummarySchema = z
  .object({
    id: z.string().uuid(),
    status: conversationStatusSchema,
    queueId: z.string().uuid(),
    queueName: z.string().min(1).max(120),
    visitorId: z.string().uuid(),
    visitorDisplayName: z.string().min(1).max(80).nullable(),
    agentId: z.string().uuid().nullable(),
    agentName: z.string().min(1).max(120).nullable(),
    dispositionId: z.string().uuid().nullable(),
    createdAt: z.string().datetime(),
    queuedAt: z.string().datetime(),
    assignedAt: z.string().datetime().nullable(),
    endedAt: z.string().datetime().nullable(),
  })
  .strict();

export const messageRecordSchema = z
  .object({
    id: z.string().uuid(),
    conversationId: z.string().uuid(),
    senderType: z.enum(['visitor', 'agent', 'system']),
    senderId: z.string().uuid().nullable(),
    requestId: z.string().uuid(),
    body: z.string().min(1).max(4000),
    createdAt: z.string().datetime(),
  })
  .strict();

export const surveyPromptSchema = z
  .object({
    prompt: z.string().min(1).max(300),
    scale: z.number().int().min(1).max(5),
    commentEnabled: z.boolean(),
  })
  .strict();

export const conversationEventSchema = z
  .object({
    id: z.string().uuid(),
    conversationId: z.string().uuid(),
    type: z.string().min(1).max(40),
    payload: z.record(z.string(), z.string()),
    createdAt: z.string().datetime(),
  })
  .strict();

export const queuePositionSchema = z
  .object({
    conversationId: z.string().uuid(),
    queueId: z.string().uuid(),
    position: z.number().int().min(1).max(100000).nullable(),
  })
  .strict();

export const presenceStatusSchema = z.enum(['available', 'busy', 'away', 'offline']);

export const desiredPresenceSchema = z.enum(['available', 'busy', 'away']);

export const presenceUpdatedSchema = z
  .object({
    agentId: z.string().uuid(),
    status: presenceStatusSchema,
  })
  .strict();

export const messageReadSchema = z
  .object({
    conversationId: z.string().uuid(),
    agentId: z.string().uuid(),
    messageId: z.string().uuid(),
  })
  .strict();

export const sectorPersonSchema = z
  .object({
    agentId: z.string().uuid(),
    name: z.string().min(1).max(120),
    role: roleSchema,
  })
  .strict();

export const sectorSummarySchema = z
  .object({
    id: z.string().uuid(),
    name: z.string().min(1).max(120),
    description: z.string().max(500),
    active: z.boolean(),
    createdAt: z.string().datetime(),
    canManage: z.boolean(),
    members: z.array(sectorPersonSchema).max(200),
    supervisors: z.array(sectorPersonSchema).max(50),
  })
  .strict();

export const internalParticipantSchema = z
  .object({
    agentId: z.string().uuid(),
    name: z.string().min(1).max(120),
  })
  .strict();

export const internalConversationSchema = z
  .object({
    id: z.string().uuid(),
    kind: z.enum(['direct', 'group']),
    sectorId: z.string().uuid().nullable(),
    title: z.string().min(1).max(120),
    unread: z.number().int().min(0).max(100000),
    participants: z.array(internalParticipantSchema).max(200),
  })
  .strict();

export const internalMessageSchema = z
  .object({
    id: z.string().uuid(),
    conversationId: z.string().uuid(),
    senderId: z.string().uuid(),
    senderName: z.string().min(1).max(120),
    requestId: z.string().uuid(),
    body: z.string().min(1).max(4000),
    createdAt: z.string().datetime(),
  })
  .strict();

export const announcementSchema = z
  .object({
    id: z.string().uuid(),
    title: z.string().min(1).max(160),
    body: z.string().min(1).max(4000),
    pinned: z.boolean(),
    audience: z.enum(['tenant', 'sectors']),
    sectorIds: z.array(z.string().uuid()).max(50),
    authorId: z.string().uuid(),
    authorName: z.string().min(1).max(120),
    publishedAt: z.string().datetime(),
    expiresAt: z.string().datetime().nullable(),
    archivedAt: z.string().datetime().nullable(),
    updatedAt: z.string().datetime(),
    unread: z.boolean(),
  })
  .strict();

export const activityTypeSchema = z
  .object({
    id: z.string().uuid(),
    name: z.string().min(1).max(120),
    active: z.boolean(),
  })
  .strict();

export const activityAssignmentSchema = z
  .object({
    id: z.string().uuid(),
    agentId: z.string().uuid(),
    agentName: z.string().min(1).max(120),
    activityTypeId: z.string().uuid(),
    activityName: z.string().min(1).max(120),
    assignedBy: z.string().uuid(),
    startedAt: z.string().datetime(),
    endedAt: z.string().datetime().nullable(),
    status: z.enum(['active', 'finished']),
  })
  .strict();

export const supervisorAgentSchema = z
  .object({
    agentId: z.string().uuid(),
    name: z.string().min(1).max(120),
    sectors: z.array(z.string().min(1).max(120)).max(50),
    presence: presenceStatusSchema,
    activityName: z.string().min(1).max(120).nullable(),
    activityStartedAt: z.string().datetime().nullable(),
    activeConversations: z.number().int().min(0).max(1000),
    updatedAt: z.string().datetime(),
    connected: z.boolean(),
  })
  .strict();

export const supervisorMetricsSchema = z
  .object({
    connected: z.number().int().min(0).max(100000),
    available: z.number().int().min(0).max(100000),
    busy: z.number().int().min(0).max(100000),
    away: z.number().int().min(0).max(100000),
    offline: z.number().int().min(0).max(100000),
    waiting: z.number().int().min(0).max(100000),
    assigned: z.number().int().min(0).max(100000),
    awaitingSurvey: z.number().int().min(0).max(100000),
    activities: z.number().int().min(0).max(100000),
    longestWaitSeconds: z.number().int().min(0).max(8640000).nullable(),
    closedInPeriod: z.number().int().min(0).max(1000000),
    generatedAt: z.string().datetime(),
  })
  .strict();

export const supervisorSnapshotSchema = z
  .object({
    metrics: supervisorMetricsSchema,
    agents: z.array(supervisorAgentSchema).max(500),
  })
  .strict();

export type Role = z.infer<typeof roleSchema>;
export type ConversationStatus = z.infer<typeof conversationStatusSchema>;
export type QueueSummary = z.infer<typeof queueSummarySchema>;
export type DispositionSummary = z.infer<typeof dispositionSummarySchema>;
export type ConversationSummary = z.infer<typeof conversationSummarySchema>;
export type MessageRecord = z.infer<typeof messageRecordSchema>;
export type SurveyPrompt = z.infer<typeof surveyPromptSchema>;
export type ConversationEvent = z.infer<typeof conversationEventSchema>;
export type QueuePosition = z.infer<typeof queuePositionSchema>;
export type PresenceStatus = z.infer<typeof presenceStatusSchema>;
export type DesiredPresence = z.infer<typeof desiredPresenceSchema>;
export type PresenceUpdated = z.infer<typeof presenceUpdatedSchema>;
export type MessageRead = z.infer<typeof messageReadSchema>;
export type SectorPerson = z.infer<typeof sectorPersonSchema>;
export type SectorSummary = z.infer<typeof sectorSummarySchema>;
export type InternalParticipant = z.infer<typeof internalParticipantSchema>;
export type InternalConversation = z.infer<typeof internalConversationSchema>;
export type InternalMessage = z.infer<typeof internalMessageSchema>;
export type Announcement = z.infer<typeof announcementSchema>;
export type ActivityType = z.infer<typeof activityTypeSchema>;
export type ActivityAssignment = z.infer<typeof activityAssignmentSchema>;
export type SupervisorAgent = z.infer<typeof supervisorAgentSchema>;
export type SupervisorMetrics = z.infer<typeof supervisorMetricsSchema>;
export type SupervisorSnapshot = z.infer<typeof supervisorSnapshotSchema>;
