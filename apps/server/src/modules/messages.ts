import type { MessageRecord, SurveyPrompt } from '@viavoip/protocol';
import type { Pool, PoolClient } from 'pg';
import { withTenant } from '../db/tenant.js';
import { assertCanSend } from '../domain/access.js';
import { DomainError } from '../domain/errors.js';
import type { ConversationRecord, Principal } from '../domain/types.js';
import { loadConversation } from './queries.js';
import { mapMessage, type MessageRow } from './rows.js';

const messageColumns = `
  id, conversation_id, sender_type, sender_id, request_id, body, created_at
`;

export async function listMessages(
  client: PoolClient,
  conversationId: string,
  tenantId: string,
  afterMessageId?: string,
): Promise<MessageRecord[]> {
  if (afterMessageId) {
    const anchor = await client.query(
      `SELECT id
       FROM messages
       WHERE id = $1 AND conversation_id = $2 AND tenant_id = $3`,
      [afterMessageId, conversationId, tenantId],
    );
    if (!anchor.rows[0]) throw new DomainError('invalid_payload', 'Cursor de histórico inválido');
  }
  const result = await client.query<MessageRow>(
    `SELECT ${messageColumns}
     FROM messages
     WHERE conversation_id = $1
       AND tenant_id = $2
       AND (
         $3::uuid IS NULL
         OR (created_at, id) > (
           SELECT created_at, id
           FROM messages
           WHERE id = $3 AND conversation_id = $1 AND tenant_id = $2
         )
       )
     ORDER BY created_at ASC, id ASC`,
    [conversationId, tenantId, afterMessageId ?? null],
  );
  return result.rows.map(mapMessage);
}

export type SendResult = {
  message: MessageRecord;
  created: boolean;
  queueId: string;
  status: ConversationRecord['status'];
  agentId: string | null;
};

export class MessageService {
  constructor(private readonly pool: Pool) {}

  async send(
    principal: Principal,
    input: { conversationId: string; requestId: string; body: string },
  ): Promise<SendResult> {
    return withTenant(this.pool, principal.tenantId, async (client) => {
      const conversation = await loadConversation(client, input.conversationId, principal.tenantId, true);
      if (!conversation) throw new DomainError('not_found', 'Conversa não encontrada');
      assertCanSend(principal, conversation);
      const sender = senderOf(principal);
      const inserted = await client.query<MessageRow>(
        `INSERT INTO messages (tenant_id, conversation_id, sender_type, sender_id, request_id, body)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (conversation_id, request_id) DO NOTHING
         RETURNING ${messageColumns}`,
        [principal.tenantId, input.conversationId, sender.type, sender.id, input.requestId, input.body],
      );
      const createdRow = inserted.rows[0];
      if (createdRow) {
        return {
          message: mapMessage(createdRow),
          created: true,
          queueId: conversation.queueId,
          status: conversation.status,
          agentId: conversation.agentId,
        };
      }
      const existing = await client.query<MessageRow>(
        `SELECT ${messageColumns}
         FROM messages
         WHERE conversation_id = $1 AND request_id = $2 AND tenant_id = $3`,
        [input.conversationId, input.requestId, principal.tenantId],
      );
      const row = existing.rows[0];
      if (!row) throw new DomainError('conflict', 'Mensagem não pôde ser confirmada');
      return {
        message: mapMessage(row),
        created: false,
        queueId: conversation.queueId,
        status: conversation.status,
        agentId: conversation.agentId,
      };
    });
  }
}

function senderOf(principal: Principal): { type: 'visitor' | 'agent'; id: string } {
  switch (principal.kind) {
    case 'visitor':
      return { type: 'visitor', id: principal.visitorId };
    case 'agent':
      return { type: 'agent', id: principal.agentId };
    case 'supervisor':
    case 'admin':
      throw new DomainError('forbidden', 'Supervisor não envia mensagens neste canal');
    default: {
      const neverPrincipal: never = principal;
      throw new DomainError('forbidden', `Principal inesperado: ${String(neverPrincipal)}`);
    }
  }
}

export async function loadActiveSurvey(
  client: PoolClient,
  tenantId: string,
): Promise<(SurveyPrompt & { id: string }) | null> {
  const result = await client.query<{ id: string; prompt: string; scale: number; comment_enabled: boolean }>(
    `SELECT id, prompt, scale, comment_enabled
     FROM survey_definitions
     WHERE tenant_id = $1 AND active = true
     ORDER BY created_at ASC
     LIMIT 1`,
    [tenantId],
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    id: row.id,
    prompt: row.prompt,
    scale: row.scale,
    commentEnabled: row.comment_enabled,
  };
}
