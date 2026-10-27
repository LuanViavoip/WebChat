import { z } from 'zod';
import { failureAckSchema } from './errors.js';
import {
  activityAssignmentSchema,
  activityTypeSchema,
  announcementSchema,
  conversationEventSchema,
  conversationSummarySchema,
  desiredPresenceSchema,
  internalConversationSchema,
  internalMessageSchema,
  messageReadSchema,
  messageRecordSchema,
  presenceStatusSchema,
  presenceUpdatedSchema,
  queuePositionSchema,
  queueSummarySchema,
  sectorSummarySchema,
  supervisorSnapshotSchema,
  surveyPromptSchema,
} from './models.js';

export const emptyObjectSchema = z.object({}).strict();

export const conversationStartSchema = z
  .object({
    queueId: z.string().uuid(),
    displayName: z.string().trim().min(1).max(80).optional(),
  })
  .strict();

export const messageSendSchema = z
  .object({
    conversationId: z.string().uuid(),
    requestId: z.string().uuid(),
    body: z.string().trim().min(1).max(4000),
  })
  .strict()
  .refine((value) => !value.body.includes('\u0000'), { message: 'caractere nulo' });

export const historySyncSchema = z
  .object({
    conversationId: z.string().uuid(),
    afterMessageId: z.string().uuid().optional(),
    afterEventId: z.string().uuid().optional(),
  })
  .strict();

export const surveySubmitSchema = z
  .object({
    conversationId: z.string().uuid(),
    score: z.number().int().min(1).max(5),
    comment: z.string().trim().max(1000).optional(),
  })
  .strict();

export const conversationActionSchema = z
  .object({
    conversationId: z.string().uuid(),
  })
  .strict();

export const conversationTransferSchema = z
  .object({
    conversationId: z.string().uuid(),
    queueId: z.string().uuid(),
  })
  .strict();

export const conversationCloseSchema = z
  .object({
    conversationId: z.string().uuid(),
    dispositionId: z.string().uuid(),
  })
  .strict();

export const presenceSetSchema = z
  .object({
    status: desiredPresenceSchema,
  })
  .strict();

export const messageReadCommandSchema = z
  .object({
    conversationId: z.string().uuid(),
    messageId: z.string().uuid(),
  })
  .strict();

const textBlock = (max: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(max)
    .refine((value) => !value.includes('\u0000'), { message: 'caractere nulo' });

export const sectorSaveSchema = z
  .object({
    sectorId: z.string().uuid().optional(),
    name: textBlock(120),
    description: z.string().trim().max(500).optional(),
    active: z.boolean().optional(),
    supervisorIds: z.array(z.string().uuid()).max(20).optional(),
  })
  .strict();

export const sectorMemberChangeSchema = z
  .object({
    sectorId: z.string().uuid(),
    agentId: z.string().uuid(),
  })
  .strict();

export const internalOpenSchema = z
  .object({
    peerId: z.string().uuid(),
  })
  .strict();

export const internalHistorySchema = z
  .object({
    conversationId: z.string().uuid(),
    beforeMessageId: z.string().uuid().optional(),
    afterMessageId: z.string().uuid().optional(),
    limit: z.number().int().min(1).max(100).optional(),
  })
  .strict()
  .refine((value) => !(value.beforeMessageId && value.afterMessageId), { message: 'cursores exclusivos' });

export const announcementListSchema = z
  .object({
    includeArchived: z.boolean().optional(),
  })
  .strict();

export const announcementPublishSchema = z
  .object({
    title: textBlock(160),
    body: textBlock(4000),
    pinned: z.boolean().optional(),
    audience: z.enum(['tenant', 'sectors']),
    sectorIds: z.array(z.string().uuid()).max(50).optional(),
    expiresAt: z.string().datetime().nullable().optional(),
  })
  .strict()
  .refine((value) => value.audience === 'tenant' || (value.sectorIds?.length ?? 0) > 0, {
    message: 'setor obrigatório',
  })
  .refine((value) => value.audience === 'sectors' || (value.sectorIds?.length ?? 0) === 0, {
    message: 'público da empresa sem setores',
  });

export const announcementUpdateSchema = z
  .object({
    announcementId: z.string().uuid(),
    title: textBlock(160),
    body: textBlock(4000),
    pinned: z.boolean().optional(),
    expiresAt: z.string().datetime().nullable().optional(),
  })
  .strict();

export const announcementIdSchema = z
  .object({
    announcementId: z.string().uuid(),
  })
  .strict();

export const activityTypeSaveSchema = z
  .object({
    activityTypeId: z.string().uuid().optional(),
    name: textBlock(120),
    active: z.boolean().optional(),
  })
  .strict();

export const activityAssignSchema = z
  .object({
    agentId: z.string().uuid(),
    activityTypeId: z.string().uuid(),
  })
  .strict();

export const activityAgentSchema = z
  .object({
    agentId: z.string().uuid(),
  })
  .strict();

export const activityHistorySchema = z
  .object({
    agentId: z.string().uuid().optional(),
  })
  .strict();

export const supervisorSnapshotCommandSchema = z
  .object({
    from: z.string().datetime().optional(),
    to: z.string().datetime().optional(),
  })
  .strict();

export const sectorListAckSchema = z.union([
  z.object({ ok: z.literal(true), sectors: z.array(sectorSummarySchema) }).strict(),
  failureAckSchema,
]);

export const sectorSaveAckSchema = z.union([
  z.object({ ok: z.literal(true), sector: sectorSummarySchema }).strict(),
  failureAckSchema,
]);

export const internalListAckSchema = z.union([
  z.object({ ok: z.literal(true), conversations: z.array(internalConversationSchema) }).strict(),
  failureAckSchema,
]);

export const internalOpenAckSchema = z.union([
  z
    .object({
      ok: z.literal(true),
      created: z.boolean(),
      conversation: internalConversationSchema,
    })
    .strict(),
  failureAckSchema,
]);

export const internalHistoryAckSchema = z.union([
  z.object({ ok: z.literal(true), messages: z.array(internalMessageSchema) }).strict(),
  failureAckSchema,
]);

export const announcementListAckSchema = z.union([
  z.object({ ok: z.literal(true), announcements: z.array(announcementSchema) }).strict(),
  failureAckSchema,
]);

export const announcementAckSchema = z.union([
  z.object({ ok: z.literal(true), announcement: announcementSchema }).strict(),
  failureAckSchema,
]);

export const activityCatalogAckSchema = z.union([
  z
    .object({
      ok: z.literal(true),
      types: z.array(activityTypeSchema),
      current: activityAssignmentSchema.nullable(),
    })
    .strict(),
  failureAckSchema,
]);

export const activityAssignmentAckSchema = z.union([
  z.object({ ok: z.literal(true), assignment: activityAssignmentSchema }).strict(),
  failureAckSchema,
]);

export const activityHistoryAckSchema = z.union([
  z.object({ ok: z.literal(true), assignments: z.array(activityAssignmentSchema) }).strict(),
  failureAckSchema,
]);

export const supervisorSnapshotAckSchema = z.union([
  z
    .object({
      ok: z.literal(true),
      snapshot: supervisorSnapshotSchema,
    })
    .strict(),
  failureAckSchema,
]);

const readableChannelSchemas = {
  'sector.list': emptyObjectSchema,
  'internal.list': emptyObjectSchema,
  'internal.open': internalOpenSchema,
  'internal.message.send': messageSendSchema,
  'internal.history': internalHistorySchema,
  'internal.message.read': messageReadCommandSchema,
  'announcement.list': announcementListSchema,
  'announcement.read': announcementIdSchema,
  'activity.catalog': emptyObjectSchema,
  'activity.assign': activityAssignSchema,
  'activity.finish': activityAgentSchema,
  'activity.history': activityHistorySchema,
} as const;

const managementChannelSchemas = {
  'sector.save': sectorSaveSchema,
  'sector.member.add': sectorMemberChangeSchema,
  'sector.member.remove': sectorMemberChangeSchema,
  'announcement.publish': announcementPublishSchema,
  'announcement.update': announcementUpdateSchema,
  'announcement.archive': announcementIdSchema,
  'activity.type.save': activityTypeSaveSchema,
  'supervisor.snapshot': supervisorSnapshotCommandSchema,
  'presence.heartbeat': emptyObjectSchema,
} as const;

export const visitorClientSchemas = {
  'queue.list': emptyObjectSchema,
  'conversation.start': conversationStartSchema,
  'conversation.leave': conversationActionSchema,
  'message.send': messageSendSchema,
  'history.sync': historySyncSchema,
  'survey.submit': surveySubmitSchema,
} as const;

export const agentClientSchemas = {
  'queue.subscribe': emptyObjectSchema,
  'conversation.claim': conversationActionSchema,
  'conversation.release': conversationActionSchema,
  'message.send': messageSendSchema,
  'conversation.transfer': conversationTransferSchema,
  'conversation.close': conversationCloseSchema,
  'history.sync': historySyncSchema,
  'presence.set': presenceSetSchema,
  'presence.heartbeat': emptyObjectSchema,
  'message.read': messageReadCommandSchema,
  ...readableChannelSchemas,
} as const;

export const supervisorClientSchemas = {
  'conversation.list': emptyObjectSchema,
  'conversation.watch': conversationActionSchema,
  'conversation.transfer': conversationTransferSchema,
  'history.sync': historySyncSchema,
  ...readableChannelSchemas,
  ...managementChannelSchemas,
} as const;

export const queueListAckSchema = z.union([
  z
    .object({
      ok: z.literal(true),
      queues: z.array(queueSummarySchema),
    })
    .strict(),
  failureAckSchema,
]);

export const conversationSnapshotAckSchema = z.union([
  z
    .object({
      ok: z.literal(true),
      created: z.boolean(),
      conversation: conversationSummarySchema,
      messages: z.array(messageRecordSchema),
      survey: surveyPromptSchema.nullable(),
    })
    .strict(),
  failureAckSchema,
]);

export const historySyncAckSchema = z.union([
  z
    .object({
      ok: z.literal(true),
      conversation: conversationSummarySchema,
      messages: z.array(messageRecordSchema),
      events: z.array(conversationEventSchema),
      survey: surveyPromptSchema.nullable(),
      lastReadMessageId: z.string().uuid().nullable(),
    })
    .strict(),
  failureAckSchema,
]);

export const messageSendAckSchema = z.union([
  z
    .object({
      ok: z.literal(true),
      requestId: z.string().uuid(),
      messageId: z.string().uuid(),
      created: z.boolean(),
    })
    .strict(),
  failureAckSchema,
]);

export const conversationAckSchema = z.union([
  z
    .object({
      ok: z.literal(true),
      conversation: conversationSummarySchema,
    })
    .strict(),
  failureAckSchema,
]);

export const conversationCloseAckSchema = z.union([
  z
    .object({
      ok: z.literal(true),
      conversation: conversationSummarySchema,
      survey: surveyPromptSchema,
    })
    .strict(),
  failureAckSchema,
]);

export const conversationListAckSchema = z.union([
  z
    .object({
      ok: z.literal(true),
      conversations: z.array(conversationSummarySchema),
    })
    .strict(),
  failureAckSchema,
]);

export const surveyRequiredSchema = z
  .object({
    conversationId: z.string().uuid(),
    survey: surveyPromptSchema,
  })
  .strict();

export const presenceAckSchema = z.union([
  z
    .object({
      ok: z.literal(true),
      status: presenceStatusSchema,
    })
    .strict(),
  failureAckSchema,
]);

export const messageReadAckSchema = z.union([
  z
    .object({
      ok: z.literal(true),
      conversationId: z.string().uuid(),
      messageId: z.string().uuid(),
      advanced: z.boolean(),
    })
    .strict(),
  failureAckSchema,
]);

export const serverEventSchemas = {
  'conversation.updated': conversationSummarySchema,
  'message.new': messageRecordSchema,
  'survey.required': surveyRequiredSchema,
  'queue.position': queuePositionSchema,
  'presence.updated': presenceUpdatedSchema,
  'message.read': messageReadSchema,
  'sector.updated': sectorSummarySchema,
  'internal.conversation.updated': internalConversationSchema,
  'internal.message.new': internalMessageSchema,
  'internal.message.read': messageReadSchema,
  'announcement.published': announcementSchema,
  'announcement.updated': announcementSchema,
  'activity.updated': activityAssignmentSchema,
  'supervisor.metrics': supervisorSnapshotSchema,
} as const;

export type VisitorClientEvent = keyof typeof visitorClientSchemas;
export type AgentClientEvent = keyof typeof agentClientSchemas;
export type SupervisorClientEvent = keyof typeof supervisorClientSchemas;
export type MessageSendInput = z.infer<typeof messageSendSchema>;
export type HistorySyncInput = z.infer<typeof historySyncSchema>;
export type SurveySubmitInput = z.infer<typeof surveySubmitSchema>;
