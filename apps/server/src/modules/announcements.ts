import { announcementSchema, type Announcement } from '@viavoip/protocol';
import type { Pool, PoolClient } from 'pg';
import { withTenant } from '../db/tenant.js';
import { isStaff } from '../domain/access.js';
import { DomainError } from '../domain/errors.js';
import type { AgentPrincipal } from '../domain/types.js';
import { writeAudit } from './audit.js';

type AnnouncementRow = {
  id: string;
  title: string;
  body: string;
  pinned: boolean;
  audience: 'tenant' | 'sectors';
  sector_ids: string[] | null;
  author_id: string;
  author_name: string;
  published_at: Date;
  expires_at: Date | null;
  archived_at: Date | null;
  updated_at: Date;
  unread: boolean;
};

export type AnnouncementMutation = {
  announcement: Announcement;
  notifyAgentIds: string[];
};

export class AnnouncementService {
  constructor(private readonly pool: Pool) {}

  async list(principal: AgentPrincipal, includeArchived = false): Promise<Announcement[]> {
    return withTenant(this.pool, principal.tenantId, (client) =>
      loadVisible(client, principal, null, isStaff(principal.kind) && includeArchived),
    );
  }

  async publish(
    principal: AgentPrincipal,
    input: {
      title: string;
      body: string;
      pinned?: boolean;
      audience: 'tenant' | 'sectors';
      sectorIds?: string[];
      expiresAt?: string | null;
    },
  ): Promise<AnnouncementMutation> {
    const sectorIds = input.sectorIds ?? [];
    return withTenant(this.pool, principal.tenantId, async (client) => {
      await assertCanPublish(client, principal, input.audience, sectorIds);
      const inserted = await client.query<{ id: string }>(
        `INSERT INTO announcements (
           tenant_id, author_id, title, body, pinned, audience, expires_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id`,
        [
          principal.tenantId,
          principal.agentId,
          input.title,
          input.body,
          input.pinned ?? false,
          input.audience,
          input.expiresAt ?? null,
        ],
      );
      const announcementId = inserted.rows[0]?.id;
      if (!announcementId) throw new DomainError('internal', 'Falha ao publicar anúncio');
      for (const sectorId of sectorIds) {
        await client.query(
          `INSERT INTO announcement_sectors (announcement_id, sector_id, tenant_id)
           VALUES ($1, $2, $3)`,
          [announcementId, sectorId, principal.tenantId],
        );
      }
      await client.query(
        `INSERT INTO announcement_revisions (tenant_id, announcement_id, editor_id, title, body)
         VALUES ($1, $2, $3, $4, $5)`,
        [principal.tenantId, announcementId, principal.agentId, input.title, input.body],
      );
      await writeAudit(client, principal.tenantId, principal.agentId, 'announcement.publish', 'announcement', announcementId);
      return mutation(client, principal, announcementId, input.audience, sectorIds);
    });
  }

  async update(
    principal: AgentPrincipal,
    input: {
      announcementId: string;
      title: string;
      body: string;
      pinned?: boolean;
      expiresAt?: string | null;
    },
  ): Promise<AnnouncementMutation> {
    return withTenant(this.pool, principal.tenantId, async (client) => {
      const current = await requireManaged(client, principal, input.announcementId);
      await client.query(
        `UPDATE announcements
         SET title = $3,
             body = $4,
             pinned = COALESCE($5, pinned),
             expires_at = $6,
             updated_at = now()
         WHERE id = $1 AND tenant_id = $2 AND archived_at IS NULL`,
        [
          input.announcementId,
          principal.tenantId,
          input.title,
          input.body,
          input.pinned ?? null,
          input.expiresAt === undefined ? current.expires_at : input.expiresAt,
        ],
      );
      await client.query(
        `INSERT INTO announcement_revisions (tenant_id, announcement_id, editor_id, title, body)
         VALUES ($1, $2, $3, $4, $5)`,
        [principal.tenantId, input.announcementId, principal.agentId, input.title, input.body],
      );
      await writeAudit(client, principal.tenantId, principal.agentId, 'announcement.update', 'announcement', input.announcementId);
      return mutation(client, principal, input.announcementId, current.audience, current.sector_ids ?? []);
    });
  }

  async archive(principal: AgentPrincipal, announcementId: string): Promise<AnnouncementMutation> {
    return withTenant(this.pool, principal.tenantId, async (client) => {
      const current = await requireManaged(client, principal, announcementId);
      await client.query(
        `UPDATE announcements
         SET archived_at = COALESCE(archived_at, now()), updated_at = now()
         WHERE id = $1 AND tenant_id = $2`,
        [announcementId, principal.tenantId],
      );
      await writeAudit(client, principal.tenantId, principal.agentId, 'announcement.archive', 'announcement', announcementId);
      return mutation(client, principal, announcementId, current.audience, current.sector_ids ?? [], true);
    });
  }

  async markRead(principal: AgentPrincipal, announcementId: string): Promise<Announcement> {
    return withTenant(this.pool, principal.tenantId, async (client) => {
      const visible = await loadVisible(client, principal, announcementId, false);
      const announcement = visible[0];
      if (!announcement) throw new DomainError('not_found', 'Anúncio não encontrado');
      await client.query(
        `INSERT INTO announcement_reads (announcement_id, agent_id, tenant_id)
         VALUES ($1, $2, $3)
         ON CONFLICT (announcement_id, agent_id) DO NOTHING`,
        [announcementId, principal.agentId, principal.tenantId],
      );
      return { ...announcement, unread: false };
    });
  }
}

async function assertCanPublish(
  client: PoolClient,
  principal: AgentPrincipal,
  audience: 'tenant' | 'sectors',
  sectorIds: string[],
): Promise<void> {
  if (principal.kind === 'agent') throw new DomainError('forbidden', 'Anúncio restrito à supervisão');
  if (audience === 'tenant' && principal.kind !== 'admin') {
    throw new DomainError('forbidden', 'Anúncio da empresa é exclusivo do administrador');
  }
  if (audience === 'sectors') await assertSectorsInScope(client, principal, sectorIds);
}

async function assertSectorsInScope(client: PoolClient, principal: AgentPrincipal, sectorIds: string[]): Promise<void> {
  if (sectorIds.length === 0) throw new DomainError('invalid_payload', 'Setor obrigatório');
  const found = await client.query<{ id: string }>(
    `SELECT id FROM sectors WHERE tenant_id = $1 AND active = true AND id = ANY($2::uuid[])`,
    [principal.tenantId, sectorIds],
  );
  if (found.rows.length !== new Set(sectorIds).size) throw new DomainError('not_found', 'Setor não encontrado');
  if (principal.kind === 'admin') return;
  const allowed = await client.query<{ sector_id: string }>(
    `SELECT sector_id FROM sector_supervisors
     WHERE tenant_id = $1 AND agent_id = $2 AND removed_at IS NULL AND sector_id = ANY($3::uuid[])`,
    [principal.tenantId, principal.agentId, sectorIds],
  );
  if (allowed.rows.length !== new Set(sectorIds).size) {
    throw new DomainError('forbidden', 'Setor fora do seu escopo');
  }
}

async function requireManaged(
  client: PoolClient,
  principal: AgentPrincipal,
  announcementId: string,
): Promise<AnnouncementRow> {
  const result = await client.query<AnnouncementRow>(
    `SELECT announcement.id, announcement.title, announcement.body, announcement.pinned, announcement.audience,
            announcement.author_id, author.name AS author_name, announcement.published_at, announcement.expires_at,
            announcement.archived_at, announcement.updated_at, false AS unread,
            COALESCE((
              SELECT array_agg(link.sector_id ORDER BY link.sector_id)
              FROM announcement_sectors AS link
              WHERE link.announcement_id = announcement.id AND link.tenant_id = announcement.tenant_id
            ), '{}') AS sector_ids
     FROM announcements AS announcement
     JOIN agents AS author ON author.id = announcement.author_id AND author.tenant_id = announcement.tenant_id
     WHERE announcement.id = $1 AND announcement.tenant_id = $2`,
    [announcementId, principal.tenantId],
  );
  const row = result.rows[0];
  if (!row) throw new DomainError('not_found', 'Anúncio não encontrado');
  await assertCanPublish(client, principal, row.audience, row.sector_ids ?? []);
  return row;
}

async function mutation(
  client: PoolClient,
  principal: AgentPrincipal,
  announcementId: string,
  audience: 'tenant' | 'sectors',
  sectorIds: string[],
  archived = false,
): Promise<AnnouncementMutation> {
  const rows = await loadVisible(client, principal, announcementId, archived);
  const announcement = rows[0];
  if (!announcement) throw new DomainError('internal', 'Anúncio não pôde ser lido');
  const notify = await client.query<{ id: string }>(
    audience === 'tenant'
      ? `SELECT id FROM agents WHERE tenant_id = $1`
      : `SELECT agent_id AS id FROM sector_members
         WHERE tenant_id = $1 AND removed_at IS NULL AND sector_id = ANY($2::uuid[])
         UNION
         SELECT agent_id FROM sector_supervisors
         WHERE tenant_id = $1 AND removed_at IS NULL AND sector_id = ANY($2::uuid[])
         UNION
         SELECT id FROM agents WHERE tenant_id = $1 AND role = 'admin'`,
    audience === 'tenant' ? [principal.tenantId] : [principal.tenantId, sectorIds],
  );
  return { announcement, notifyAgentIds: notify.rows.map((row) => row.id) };
}

async function loadVisible(
  client: PoolClient,
  principal: AgentPrincipal,
  announcementId: string | null,
  includeArchived: boolean,
): Promise<Announcement[]> {
  const result = await client.query<AnnouncementRow>(
    `SELECT announcement.id, announcement.title, announcement.body, announcement.pinned, announcement.audience,
            announcement.author_id, author.name AS author_name, announcement.published_at, announcement.expires_at,
            announcement.archived_at, announcement.updated_at,
            NOT EXISTS (
              SELECT 1 FROM announcement_reads AS read_mark
              WHERE read_mark.announcement_id = announcement.id
                AND read_mark.agent_id = $2
                AND read_mark.tenant_id = announcement.tenant_id
            ) AS unread,
            COALESCE((
              SELECT array_agg(link.sector_id ORDER BY link.sector_id)
              FROM announcement_sectors AS link
              WHERE link.announcement_id = announcement.id AND link.tenant_id = announcement.tenant_id
            ), '{}') AS sector_ids
     FROM announcements AS announcement
     JOIN agents AS author ON author.id = announcement.author_id AND author.tenant_id = announcement.tenant_id
     WHERE announcement.tenant_id = $1
       AND ($3::uuid IS NULL OR announcement.id = $3)
       AND (
         ($4::boolean AND announcement.archived_at IS NOT NULL)
         OR (
           announcement.archived_at IS NULL
           AND (announcement.expires_at IS NULL OR announcement.expires_at > now())
         )
       )
       AND (
         announcement.audience = 'tenant'
         OR $5::boolean
         OR EXISTS (
           SELECT 1
           FROM announcement_sectors AS link
           JOIN sector_members AS member
             ON member.sector_id = link.sector_id
            AND member.tenant_id = link.tenant_id
           WHERE link.announcement_id = announcement.id
             AND member.agent_id = $2
             AND member.removed_at IS NULL
         )
         OR EXISTS (
           SELECT 1
           FROM announcement_sectors AS link
           JOIN sector_supervisors AS lead
             ON lead.sector_id = link.sector_id
            AND lead.tenant_id = link.tenant_id
           WHERE link.announcement_id = announcement.id
             AND lead.agent_id = $2
             AND lead.removed_at IS NULL
         )
       )
     ORDER BY announcement.pinned DESC, announcement.published_at DESC`,
    [principal.tenantId, principal.agentId, announcementId, includeArchived, principal.kind === 'admin'],
  );
  return result.rows.map((row) =>
    announcementSchema.parse({
      id: row.id,
      title: row.title,
      body: row.body,
      pinned: row.pinned,
      audience: row.audience,
      sectorIds: row.sector_ids ?? [],
      authorId: row.author_id,
      authorName: row.author_name,
      publishedAt: row.published_at.toISOString(),
      expiresAt: row.expires_at ? row.expires_at.toISOString() : null,
      archivedAt: row.archived_at ? row.archived_at.toISOString() : null,
      updatedAt: row.updated_at.toISOString(),
      unread: row.unread,
    }),
  );
}
