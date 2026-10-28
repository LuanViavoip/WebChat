import {
  auditPageSchema,
  knownAuditActions,
  type AuditPage,
  type AuditQuery,
  type KnownAuditAction,
} from '@viavoip/protocol';
import type { Pool } from 'pg';
import { withTenant } from '../db/tenant.js';
import { assertCompanyAccess } from '../domain/company-access.js';
import { DomainError } from '../domain/errors.js';
import type { AgentPrincipal } from '../domain/types.js';

const maxWindowMs = 31 * 24 * 60 * 60 * 1000;
const known = new Set<string>(knownAuditActions);

export class AuditQueryService {
  constructor(
    private readonly pool: Pool,
    private readonly pageSize = 50,
  ) {}

  async page(principal: AgentPrincipal, query: AuditQuery): Promise<AuditPage> {
    if (query.from && query.to) {
      const span = Date.parse(query.to) - Date.parse(query.from);
      if (!Number.isFinite(span) || span <= 0 || span > maxWindowMs) {
        throw new DomainError('invalid_payload', 'Período inválido');
      }
    }
    return withTenant(this.pool, principal.tenantId, async (client) => {
      await assertCompanyAccess(client, principal, { capability: 'audit.read' });
      const params: unknown[] = [principal.tenantId];
      const filters = ['event.tenant_id = $1'];
      if (query.action) {
        params.push(query.action);
        filters.push(`event.action = $${params.length}`);
      }
      if (query.from && query.to) {
        params.push(query.from, query.to);
        filters.push(`event.created_at >= $${params.length - 1} AND event.created_at < $${params.length}`);
      } else if (!query.from && !query.to) {
        filters.push(`event.created_at >= now() - interval '24 hours' AND event.created_at <= now()`);
      } else {
        throw new DomainError('invalid_payload', 'Período inválido');
      }
      if (query.cursor) {
        const cursor = decodeCursor(query.cursor);
        params.push(cursor.at, cursor.id);
        filters.push(
          `(event.created_at, event.id) < ($${params.length - 1}::timestamptz, $${params.length}::uuid)`,
        );
      }
      params.push(this.pageSize + 1);
      const rows = await client.query<{
        id: string;
        created_at: Date;
        actor_id: string;
        actor_name: string;
        action: string;
        resource_type: string;
        resource_id: string | null;
      }>(
        `SELECT event.id, event.created_at, event.actor_id, actor.name AS actor_name,
                event.action, event.resource_type, event.resource_id
         FROM audit_events AS event
         JOIN agents AS actor ON actor.id = event.actor_id AND actor.tenant_id = event.tenant_id
         WHERE ${filters.join(' AND ')}
         ORDER BY event.created_at DESC, event.id DESC
         LIMIT $${params.length}`,
        params,
      );
      const page = rows.rows.slice(0, this.pageSize);
      const last = page[page.length - 1];
      return auditPageSchema.parse({
        entries: page.map((row) => ({
          id: row.id,
          at: row.created_at.toISOString(),
          actorId: row.actor_id,
          actorName: row.actor_name,
          action: known.has(row.action)
            ? { kind: row.action as KnownAuditAction }
            : { kind: 'unrecognized', raw: row.action },
          resource: row.resource_id
            ? { presence: 'id', type: row.resource_type, id: row.resource_id }
            : { presence: 'none', type: row.resource_type },
        })),
        nextCursor: rows.rows.length > this.pageSize && last ? encodeCursor(last.created_at, last.id) : null,
      });
    });
  }
}

function encodeCursor(at: Date, id: string): string {
  return Buffer.from(`${at.toISOString()}|${id}`).toString('base64url');
}

function decodeCursor(cursor: string): { at: string; id: string } {
  const decoded = Buffer.from(cursor, 'base64url').toString('utf8');
  const separator = decoded.lastIndexOf('|');
  const at = decoded.slice(0, separator);
  const id = decoded.slice(separator + 1);
  if (!at || !id) throw new DomainError('invalid_payload', 'Cursor inválido');
  return { at, id };
}
