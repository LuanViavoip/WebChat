import { conversationEventSchema, type ConversationEvent } from '@viavoip/protocol';
import type { PoolClient } from 'pg';
import { DomainError } from '../domain/errors.js';
import type { ConversationRecord } from '../domain/types.js';
import { conversationColumns, conversationJoins, mapConversation, type ConversationRow } from './rows.js';

export async function loadConversation(
  client: PoolClient,
  conversationId: string,
  tenantId: string,
  lock: boolean,
): Promise<ConversationRecord | null> {
  const result = await client.query<ConversationRow>(
    `SELECT ${conversationColumns}
     FROM conversations AS conversation
     ${conversationJoins}
     WHERE conversation.id = $1 AND conversation.tenant_id = $2
     ${lock ? 'FOR UPDATE OF conversation' : ''}`,
    [conversationId, tenantId],
  );
  const row = result.rows[0];
  return row ? mapConversation(row) : null;
}

export async function listEvents(
  client: PoolClient,
  conversationId: string,
  tenantId: string,
  afterEventId?: string,
): Promise<ConversationEvent[]> {
  if (afterEventId) {
    const anchor = await client.query(
      `SELECT id
       FROM conversation_events
       WHERE id = $1 AND conversation_id = $2 AND tenant_id = $3`,
      [afterEventId, conversationId, tenantId],
    );
    if (!anchor.rows[0]) throw new DomainError('invalid_payload', 'Cursor de evento inválido');
  }
  const result = await client.query<{
    id: string;
    conversation_id: string;
    type: string;
    payload: unknown;
    created_at: Date;
  }>(
    `SELECT id, conversation_id, type, payload, created_at
     FROM conversation_events
     WHERE conversation_id = $1
       AND tenant_id = $2
       AND (
         $3::uuid IS NULL
         OR (created_at, id) > (
           SELECT created_at, id
           FROM conversation_events
           WHERE id = $3 AND conversation_id = $1 AND tenant_id = $2
         )
       )
     ORDER BY created_at ASC, id ASC`,
    [conversationId, tenantId, afterEventId ?? null],
  );
  return result.rows.map((row) =>
    conversationEventSchema.parse({
      id: row.id,
      conversationId: row.conversation_id,
      type: row.type,
      payload: stringPayload(row.payload),
      createdAt: row.created_at.toISOString(),
    }),
  );
}

function stringPayload(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const entries = Object.entries(value).flatMap(([key, item]) =>
    typeof item === 'string' ? [[key, item] as const] : [],
  );
  return Object.fromEntries(entries);
}

export async function addEvent(
  client: PoolClient,
  tenantId: string,
  conversationId: string,
  type: string,
  payload: Record<string, string | null>,
): Promise<void> {
  await client.query(
    `INSERT INTO conversation_events (tenant_id, conversation_id, type, payload)
     VALUES ($1, $2, $3, $4::jsonb)`,
    [tenantId, conversationId, type, JSON.stringify(payload)],
  );
}
