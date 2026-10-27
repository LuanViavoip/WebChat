import {
  internalConversationSchema,
  internalMessageSchema,
  type InternalConversation,
  type InternalMessage,
} from '@viavoip/protocol';
import type { Pool, PoolClient } from 'pg';
import { withTenant, withTenantAdvisoryLock } from '../db/tenant.js';
import { internalConversationLockKey, internalSectorLockKey } from '../db/locks.js';
import { isStaff } from '../domain/access.js';
import { DomainError } from '../domain/errors.js';
import type { AgentPrincipal } from '../domain/types.js';

const pageDefault = 50;

type ConversationRow = {
  id: string;
  kind: 'direct' | 'group';
  sector_id: string | null;
  title: string;
  unread: number;
};

type ParticipantRow = {
  conversation_id: string;
  agent_id: string;
  name: string;
};

type MessageRow = {
  id: string;
  conversation_id: string;
  sender_id: string;
  sender_name: string;
  request_id: string;
  body: string;
  created_at: Date;
};

export class InternalChatService {
  constructor(private readonly pool: Pool) {}

  async list(principal: AgentPrincipal): Promise<InternalConversation[]> {
    return withTenant(this.pool, principal.tenantId, (client) => listConversations(client, principal));
  }

  async open(principal: AgentPrincipal, peerId: string): Promise<{ created: boolean; conversation: InternalConversation }> {
    return withTenant(this.pool, principal.tenantId, async (client) => {
      await assertCanDirect(client, principal, peerId);
      const pairKey = directPairKey(principal.agentId, peerId);
      const inserted = await client.query<{ id: string }>(
        `INSERT INTO internal_conversations (tenant_id, kind, pair_key)
         VALUES ($1, 'direct', $2)
         ON CONFLICT (tenant_id, pair_key) WHERE kind = 'direct' DO NOTHING
         RETURNING id`,
        [principal.tenantId, pairKey],
      );
      const created = Boolean(inserted.rows[0]);
      const existing = inserted.rows[0]
        ? inserted.rows[0]
        : (
            await client.query<{ id: string }>(
              `SELECT id FROM internal_conversations
               WHERE tenant_id = $1 AND kind = 'direct' AND pair_key = $2`,
              [principal.tenantId, pairKey],
            )
          ).rows[0];
      if (!existing) throw new DomainError('internal', 'Conversa direta não pôde ser aberta');
      for (const agentId of [principal.agentId, peerId]) {
        await client.query(
          `INSERT INTO internal_participants (conversation_id, agent_id, tenant_id)
           VALUES ($1, $2, $3)
           ON CONFLICT (conversation_id, agent_id) DO UPDATE SET removed_at = NULL`,
          [existing.id, agentId, principal.tenantId],
        );
      }
      const conversation = await oneConversation(client, principal, existing.id);
      return { created, conversation };
    });
  }

  async send(
    principal: AgentPrincipal,
    input: { conversationId: string; requestId: string; body: string },
    afterCommit?: (message: InternalMessage, recipientAgentIds: string[]) => Promise<void> | void,
  ): Promise<{ message: InternalMessage; created: boolean; recipientAgentIds: string[] }> {
    const lockKey = await this.deliveryLockKey(principal.tenantId, input.conversationId);
    return withTenantAdvisoryLock(this.pool, principal.tenantId, lockKey, async (client) => {
      const conversation = await requireWritable(client, principal, input.conversationId);
      const recipients = await activeParticipantsIn(client, input.conversationId, principal.tenantId);
      const inserted = await client.query<MessageRow>(
        `INSERT INTO internal_messages (tenant_id, conversation_id, sender_id, request_id, body)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (conversation_id, request_id) DO NOTHING
         RETURNING id, conversation_id, sender_id, $6::text AS sender_name, request_id, body, created_at`,
        [principal.tenantId, conversation.id, principal.agentId, input.requestId, input.body, principal.name],
      );
      const createdRow = inserted.rows[0];
      if (createdRow) return { message: mapMessage(createdRow), created: true, recipientAgentIds: recipients };
      const existing = await client.query<MessageRow>(
        `SELECT message.id, message.conversation_id, message.sender_id, agent.name AS sender_name,
                message.request_id, message.body, message.created_at
         FROM internal_messages AS message
         JOIN agents AS agent ON agent.id = message.sender_id AND agent.tenant_id = message.tenant_id
         WHERE message.conversation_id = $1 AND message.request_id = $2 AND message.tenant_id = $3`,
        [input.conversationId, input.requestId, principal.tenantId],
      );
      const row = existing.rows[0];
      if (!row) throw new DomainError('conflict', 'Mensagem não pôde ser confirmada');
      return { message: mapMessage(row), created: false, recipientAgentIds: recipients };
    }, async (result) => {
      if (result.created) await afterCommit?.(result.message, result.recipientAgentIds);
    });
  }

  async history(
    principal: AgentPrincipal,
    input: { conversationId: string; beforeMessageId?: string; afterMessageId?: string; limit?: number },
  ): Promise<InternalMessage[]> {
    return withTenant(this.pool, principal.tenantId, async (client) => {
      await requireParticipant(client, principal, input.conversationId);
      if (input.beforeMessageId) await requireVisibleMessage(client, principal, input.conversationId, input.beforeMessageId);
      if (input.afterMessageId) await requireVisibleMessage(client, principal, input.conversationId, input.afterMessageId);
      const limit = input.limit ?? pageDefault;
      const order = input.afterMessageId ? 'ASC' : 'DESC';
      const result = await client.query<MessageRow>(
        `SELECT message.id, message.conversation_id, message.sender_id, agent.name AS sender_name,
                message.request_id, message.body, message.created_at
         FROM internal_messages AS message
         JOIN agents AS agent ON agent.id = message.sender_id AND agent.tenant_id = message.tenant_id
         JOIN internal_participants AS participant
           ON participant.conversation_id = message.conversation_id
          AND participant.agent_id = $2
          AND participant.tenant_id = message.tenant_id
         WHERE message.conversation_id = $1
           AND message.tenant_id = $3
           AND (participant.removed_at IS NULL OR message.created_at <= participant.removed_at)
           AND (
             $4::uuid IS NULL
             OR (message.created_at, message.id) < (
               SELECT anchor.created_at, anchor.id
               FROM internal_messages AS anchor
               WHERE anchor.id = $4 AND anchor.conversation_id = message.conversation_id
             )
           )
           AND (
             $5::uuid IS NULL
             OR (message.created_at, message.id) > (
               SELECT anchor.created_at, anchor.id
               FROM internal_messages AS anchor
               WHERE anchor.id = $5 AND anchor.conversation_id = message.conversation_id
             )
           )
         ORDER BY message.created_at ${order}, message.id ${order}
         LIMIT $6`,
        [
          input.conversationId,
          principal.agentId,
          principal.tenantId,
          input.beforeMessageId ?? null,
          input.afterMessageId ?? null,
          limit,
        ],
      );
      const rows = input.afterMessageId ? result.rows : result.rows.reverse();
      return rows.map(mapMessage);
    });
  }

  async markRead(
    principal: AgentPrincipal,
    conversationId: string,
    messageId: string,
    afterCommit?: (recipientAgentIds: string[]) => Promise<void> | void,
  ): Promise<{ advanced: boolean; recipientAgentIds: string[] }> {
    const lockKey = await this.deliveryLockKey(principal.tenantId, conversationId);
    return withTenantAdvisoryLock(this.pool, principal.tenantId, lockKey, async (client) => {
      await requireVisibleMessage(client, principal, conversationId, messageId);
      const recipients = await activeParticipantsIn(client, conversationId, principal.tenantId);
      const updated = await client.query(
        `INSERT INTO internal_reads (conversation_id, agent_id, tenant_id, last_read_message_id)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (conversation_id, agent_id) DO UPDATE
         SET last_read_message_id = EXCLUDED.last_read_message_id,
             read_at = now()
         WHERE (
           SELECT ROW(created_at, id) FROM internal_messages
           WHERE id = internal_reads.last_read_message_id
         ) < (
           SELECT ROW(created_at, id) FROM internal_messages
           WHERE id = EXCLUDED.last_read_message_id
         )
         RETURNING conversation_id`,
        [conversationId, principal.agentId, principal.tenantId, messageId],
      );
      return { advanced: Boolean(updated.rows[0]), recipientAgentIds: recipients };
    }, async (result) => {
      if (result.advanced) await afterCommit?.(result.recipientAgentIds);
    });
  }

  private async deliveryLockKey(tenantId: string, conversationId: string): Promise<string> {
    const conversation = await withTenant(this.pool, tenantId, async (client) => {
      const result = await client.query<{ kind: 'direct' | 'group'; sector_id: string | null }>(
        `SELECT kind, sector_id FROM internal_conversations WHERE id = $1 AND tenant_id = $2`,
        [conversationId, tenantId],
      );
      return result.rows[0];
    });
    return conversation?.kind === 'group' && conversation.sector_id
      ? internalSectorLockKey(tenantId, conversation.sector_id)
      : internalConversationLockKey(tenantId, conversationId);
  }

  async roomsFor(principal: AgentPrincipal): Promise<{ conversationIds: string[]; sectorIds: string[] }> {
    return withTenant(this.pool, principal.tenantId, async (client) => {
      const conversations = await client.query<{ id: string }>(
        `SELECT conversation.id
         FROM internal_conversations AS conversation
         JOIN internal_participants AS participant
           ON participant.conversation_id = conversation.id
          AND participant.tenant_id = conversation.tenant_id
         WHERE participant.agent_id = $1
           AND participant.tenant_id = $2
           AND participant.removed_at IS NULL
           AND (conversation.kind <> 'group' OR EXISTS (
             SELECT 1 FROM sectors AS sector
             WHERE sector.id = conversation.sector_id
               AND sector.tenant_id = conversation.tenant_id
               AND sector.active = true
           ))`,
        [principal.agentId, principal.tenantId],
      );
      const sectors = await client.query<{ id: string }>(
        `SELECT sector.id
         FROM sectors AS sector
         WHERE sector.tenant_id = $1
           AND (
             EXISTS (
               SELECT 1 FROM sector_members AS member
               WHERE member.sector_id = sector.id
                 AND member.agent_id = $2
                 AND member.tenant_id = sector.tenant_id
                 AND member.removed_at IS NULL
             )
             OR EXISTS (
               SELECT 1 FROM sector_supervisors AS lead
               WHERE lead.sector_id = sector.id
                 AND lead.agent_id = $2
                 AND lead.tenant_id = sector.tenant_id
                 AND lead.removed_at IS NULL
             )
           )`,
        [principal.tenantId, principal.agentId],
      );
      return {
        conversationIds: conversations.rows.map((row) => row.id),
        sectorIds: sectors.rows.map((row) => row.id),
      };
    });
  }

  async activeParticipants(conversationId: string, tenantId: string): Promise<string[]> {
    return withTenant(this.pool, tenantId, async (client) => {
      const result = await client.query<{ agent_id: string }>(
        `SELECT participant.agent_id
         FROM internal_participants AS participant
         JOIN internal_conversations AS conversation
           ON conversation.id = participant.conversation_id
          AND conversation.tenant_id = participant.tenant_id
         LEFT JOIN sectors AS sector
           ON sector.id = conversation.sector_id
          AND sector.tenant_id = conversation.tenant_id
         WHERE participant.conversation_id = $1
           AND participant.tenant_id = $2
           AND participant.removed_at IS NULL
           AND (conversation.kind <> 'group' OR sector.active = true)`,
        [conversationId, tenantId],
      );
      return result.rows.map((row) => row.agent_id);
    });
  }

  async summarize(principal: AgentPrincipal, conversationId: string): Promise<InternalConversation> {
    return withTenant(this.pool, principal.tenantId, (client) => oneConversation(client, principal, conversationId));
  }
}

function directPairKey(left: string, right: string): string {
  return [left, right].sort().join(':');
}

async function activeParticipantsIn(client: PoolClient, conversationId: string, tenantId: string): Promise<string[]> {
  const result = await client.query<{ agent_id: string }>(
    `SELECT participant.agent_id
     FROM internal_participants AS participant
     JOIN internal_conversations AS conversation
       ON conversation.id = participant.conversation_id
      AND conversation.tenant_id = participant.tenant_id
     LEFT JOIN sectors AS sector
       ON sector.id = conversation.sector_id
      AND sector.tenant_id = conversation.tenant_id
     WHERE participant.conversation_id = $1
       AND participant.tenant_id = $2
       AND participant.removed_at IS NULL
       AND (conversation.kind <> 'group' OR sector.active = true)`,
    [conversationId, tenantId],
  );
  return result.rows.map((row) => row.agent_id);
}

async function assertCanDirect(client: PoolClient, principal: AgentPrincipal, peerId: string): Promise<void> {
  if (peerId === principal.agentId) throw new DomainError('forbidden', 'Conversa direta exige outra pessoa');
  const peer = await client.query<{ role: AgentPrincipal['kind'] }>(
    `SELECT role FROM agents WHERE id = $1 AND tenant_id = $2`,
    [peerId, principal.tenantId],
  );
  const role = peer.rows[0]?.role;
  if (!role) throw new DomainError('not_found', 'Pessoa não encontrada');
  if (principal.kind === 'agent' && role === 'agent') {
    throw new DomainError('forbidden', 'Conversa direta entre agentes não está habilitada');
  }
  if (principal.kind === 'admin' || role === 'admin') return;
  if (isStaff(principal.kind) && isStaff(role)) return;
  const agentId = principal.kind === 'agent' ? principal.agentId : peerId;
  const supervisorId = principal.kind === 'agent' ? peerId : principal.agentId;
  const shared = await client.query(
    `SELECT 1
     FROM sector_members AS member
     JOIN sector_supervisors AS lead
       ON lead.sector_id = member.sector_id
      AND lead.tenant_id = member.tenant_id
     JOIN sectors AS sector
       ON sector.id = member.sector_id
      AND sector.tenant_id = member.tenant_id
     WHERE member.agent_id = $1
       AND member.tenant_id = $3
       AND member.removed_at IS NULL
       AND lead.agent_id = $2
       AND lead.removed_at IS NULL
       AND sector.active = true`,
    [agentId, supervisorId, principal.tenantId],
  );
  if (!shared.rows[0]) throw new DomainError('forbidden', 'Conversa direta fora do setor em comum');
}

async function requireWritable(
  client: PoolClient,
  principal: AgentPrincipal,
  conversationId: string,
): Promise<{ id: string; kind: 'direct' | 'group' }> {
  const result = await client.query<{ id: string; kind: 'direct' | 'group'; sector_id: string | null; active: boolean | null; pair_key: string | null }>(
    `SELECT conversation.id, conversation.kind, conversation.sector_id, conversation.pair_key, sector.active
     FROM internal_conversations AS conversation
     LEFT JOIN sectors AS sector
       ON sector.id = conversation.sector_id
      AND sector.tenant_id = conversation.tenant_id
     WHERE conversation.id = $1 AND conversation.tenant_id = $2`,
    [conversationId, principal.tenantId],
  );
  const conversation = result.rows[0];
  if (!conversation) throw new DomainError('not_found', 'Conversa não encontrada');
  const participant = await client.query<{ removed_at: Date | null }>(
    `SELECT removed_at FROM internal_participants
     WHERE conversation_id = $1 AND agent_id = $2 AND tenant_id = $3`,
    [conversationId, principal.agentId, principal.tenantId],
  );
  if (!participant.rows[0] || participant.rows[0].removed_at) {
    throw new DomainError('forbidden', 'Conversa fora da sua participação');
  }
  if (conversation.kind === 'group' && conversation.active !== true) {
    throw new DomainError('invalid_state', 'Setor inativo');
  }
  if (conversation.kind === 'direct' && conversation.pair_key) {
    const peerId = conversation.pair_key.split(':').find((id) => id !== principal.agentId);
    if (!peerId) throw new DomainError('internal', 'Par da conversa inválido');
    await assertCanDirect(client, principal, peerId);
  }
  return { id: conversation.id, kind: conversation.kind };
}

async function requireParticipant(client: PoolClient, principal: AgentPrincipal, conversationId: string): Promise<void> {
  const result = await client.query(
    `SELECT 1
     FROM internal_participants
     WHERE conversation_id = $1 AND agent_id = $2 AND tenant_id = $3`,
    [conversationId, principal.agentId, principal.tenantId],
  );
  if (result.rows[0]) return;
  const conversation = await client.query(
    `SELECT 1 FROM internal_conversations WHERE id = $1 AND tenant_id = $2`,
    [conversationId, principal.tenantId],
  );
  if (!conversation.rows[0]) throw new DomainError('not_found', 'Conversa não encontrada');
  throw new DomainError('forbidden', 'Conversa fora da sua participação');
}

async function requireVisibleMessage(
  client: PoolClient,
  principal: AgentPrincipal,
  conversationId: string,
  messageId: string,
): Promise<void> {
  await requireParticipant(client, principal, conversationId);
  const result = await client.query(
    `SELECT 1
     FROM internal_messages AS message
     JOIN internal_participants AS participant
       ON participant.conversation_id = message.conversation_id
      AND participant.agent_id = $3
      AND participant.tenant_id = message.tenant_id
     WHERE message.id = $1
       AND message.conversation_id = $2
       AND message.tenant_id = $4
       AND (participant.removed_at IS NULL OR message.created_at <= participant.removed_at)`,
    [messageId, conversationId, principal.agentId, principal.tenantId],
  );
  if (!result.rows[0]) throw new DomainError('invalid_payload', 'Cursor de histórico inválido');
}

async function listConversations(client: PoolClient, principal: AgentPrincipal): Promise<InternalConversation[]> {
  const result = await client.query<ConversationRow>(
    `SELECT conversation.id,
            conversation.kind,
            conversation.sector_id,
            COALESCE(
              CASE
                WHEN conversation.kind = 'group' THEN sector.name
                ELSE (
                  SELECT agent.name
                  FROM internal_participants AS other_participant
                  JOIN agents AS agent
                    ON agent.id = other_participant.agent_id
                   AND agent.tenant_id = other_participant.tenant_id
                  WHERE other_participant.conversation_id = conversation.id
                    AND other_participant.tenant_id = conversation.tenant_id
                    AND other_participant.agent_id <> $2
                  ORDER BY agent.name
                  LIMIT 1
                )
              END,
              'Conversa direta'
            ) AS title,
            (
              SELECT count(*)::int
              FROM internal_messages AS message
              LEFT JOIN internal_reads AS read_cursor
                ON read_cursor.conversation_id = conversation.id
               AND read_cursor.agent_id = $2
               AND read_cursor.tenant_id = conversation.tenant_id
              LEFT JOIN internal_messages AS cursor_message
                ON cursor_message.id = read_cursor.last_read_message_id
              WHERE message.conversation_id = conversation.id
                AND message.tenant_id = conversation.tenant_id
                AND message.sender_id <> $2
                AND (participant.removed_at IS NULL OR message.created_at <= participant.removed_at)
                AND (
                  cursor_message.id IS NULL
                  OR (message.created_at, message.id) > (cursor_message.created_at, cursor_message.id)
                )
            ) AS unread
     FROM internal_conversations AS conversation
     JOIN internal_participants AS participant
       ON participant.conversation_id = conversation.id
      AND participant.tenant_id = conversation.tenant_id
      AND participant.agent_id = $2
     LEFT JOIN sectors AS sector
       ON sector.id = conversation.sector_id
      AND sector.tenant_id = conversation.tenant_id
     WHERE conversation.tenant_id = $1
     ORDER BY conversation.created_at DESC`,
    [principal.tenantId, principal.agentId],
  );
  return attachParticipants(client, principal.tenantId, result.rows);
}

async function oneConversation(
  client: PoolClient,
  principal: AgentPrincipal,
  conversationId: string,
): Promise<InternalConversation> {
  const conversations = await listConversations(client, principal);
  const conversation = conversations.find((item) => item.id === conversationId);
  if (!conversation) throw new DomainError('not_found', 'Conversa não encontrada');
  return conversation;
}

async function attachParticipants(
  client: PoolClient,
  tenantId: string,
  rows: ConversationRow[],
): Promise<InternalConversation[]> {
  if (rows.length === 0) return [];
  const people = await client.query<ParticipantRow>(
    `SELECT participant.conversation_id, agent.id AS agent_id, agent.name
     FROM internal_participants AS participant
     JOIN agents AS agent ON agent.id = participant.agent_id AND agent.tenant_id = participant.tenant_id
     WHERE participant.tenant_id = $1
       AND participant.removed_at IS NULL
       AND participant.conversation_id = ANY($2::uuid[])
     ORDER BY agent.name`,
    [tenantId, rows.map((row) => row.id)],
  );
  return rows.map((row) =>
    internalConversationSchema.parse({
      id: row.id,
      kind: row.kind,
      sectorId: row.sector_id,
      title: row.title,
      unread: row.unread,
      participants: people.rows
        .filter((person) => person.conversation_id === row.id)
        .map((person) => ({ agentId: person.agent_id, name: person.name })),
    }),
  );
}

function mapMessage(row: MessageRow): InternalMessage {
  return internalMessageSchema.parse({
    id: row.id,
    conversationId: row.conversation_id,
    senderId: row.sender_id,
    senderName: row.sender_name,
    requestId: row.request_id,
    body: row.body,
    createdAt: row.created_at.toISOString(),
  });
}
