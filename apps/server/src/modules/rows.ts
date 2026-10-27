import {
  conversationSummarySchema,
  messageRecordSchema,
  surveyPromptSchema,
  type ConversationSummary,
  type MessageRecord,
  type SurveyPrompt,
} from '@viavoip/protocol';
import type { ConversationRecord } from '../domain/types.js';

export type ConversationRow = {
  id: string;
  status: string;
  queue_id: string;
  queue_name: string;
  visitor_id: string;
  agent_id: string | null;
  disposition_id: string | null;
  site_id: string;
  created_at: Date;
  queued_at: Date;
  assigned_at: Date | null;
  ended_at: Date | null;
  version: number;
  visitor_display_name: string | null;
  agent_name: string | null;
};

export type MessageRow = {
  id: string;
  conversation_id: string;
  sender_type: string;
  sender_id: string | null;
  request_id: string;
  body: string;
  created_at: Date;
};

export type SurveyRow = {
  id: string;
  prompt: string;
  scale: number;
  comment_enabled: boolean;
};

export const conversationColumns = `
  conversation.id,
  conversation.status,
  conversation.queue_id,
  queue.name AS queue_name,
  conversation.visitor_id,
  conversation.agent_id,
  conversation.disposition_id,
  conversation.site_id,
  conversation.created_at,
  conversation.queued_at,
  conversation.assigned_at,
  conversation.ended_at,
  conversation.version,
  visitor.display_name AS visitor_display_name,
  agent.name AS agent_name
`;

export const conversationJoins = `
  JOIN queues AS queue ON queue.id = conversation.queue_id AND queue.tenant_id = conversation.tenant_id
  JOIN visitors AS visitor ON visitor.id = conversation.visitor_id AND visitor.tenant_id = conversation.tenant_id
  LEFT JOIN agents AS agent ON agent.id = conversation.agent_id AND agent.tenant_id = conversation.tenant_id
`;

export function mapConversation(row: ConversationRow): ConversationRecord {
  const summary = conversationSummarySchema.parse({
    id: row.id,
    status: row.status,
    queueId: row.queue_id,
    queueName: row.queue_name,
    visitorId: row.visitor_id,
    visitorDisplayName: row.visitor_display_name,
    agentId: row.agent_id,
    agentName: row.agent_name,
    dispositionId: row.disposition_id,
    createdAt: row.created_at.toISOString(),
    queuedAt: row.queued_at.toISOString(),
    assignedAt: row.assigned_at ? row.assigned_at.toISOString() : null,
    endedAt: row.ended_at ? row.ended_at.toISOString() : null,
  });
  return { ...summary, siteId: row.site_id, version: row.version };
}

export function toSummary(record: ConversationRecord): ConversationSummary {
  return conversationSummarySchema.parse({
    id: record.id,
    status: record.status,
    queueId: record.queueId,
    queueName: record.queueName,
    visitorId: record.visitorId,
    visitorDisplayName: record.visitorDisplayName,
    agentId: record.agentId,
    agentName: record.agentName,
    dispositionId: record.dispositionId,
    createdAt: record.createdAt,
    queuedAt: record.queuedAt,
    assignedAt: record.assignedAt,
    endedAt: record.endedAt,
  });
}

export function mapMessage(row: MessageRow): MessageRecord {
  return messageRecordSchema.parse({
    id: row.id,
    conversationId: row.conversation_id,
    senderType: row.sender_type,
    senderId: row.sender_id,
    requestId: row.request_id,
    body: row.body,
    createdAt: row.created_at.toISOString(),
  });
}

export function mapSurvey(row: SurveyRow): SurveyPrompt {
  return surveyPromptSchema.parse({
    prompt: row.prompt,
    scale: row.scale,
    commentEnabled: row.comment_enabled,
  });
}
