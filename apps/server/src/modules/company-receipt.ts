import { createHash } from 'node:crypto';
import type { CompanyCommand } from '@viavoip/protocol';
import type { PoolClient } from 'pg';
import { DomainError } from '../domain/errors.js';

export type CommandReceipt = {
  replayed: boolean;
  appliedAt: string;
};

export function commandPayloadHash(command: CompanyCommand): string {
  return createHash('sha256').update(canonicalJson(command)).digest('hex');
}

export async function withCommandReceipt(
  client: PoolClient,
  input: {
    tenantId: string;
    actorId: string;
    requestId: string;
    commandKind: string;
    payloadHash: string;
  },
  apply: () => Promise<void>,
): Promise<CommandReceipt> {
  const locked = await client.query<{ locked: boolean }>(
    `SELECT pg_try_advisory_xact_lock(hashtextextended($1::text, 0)) AS locked`,
    [`${input.tenantId}:${input.actorId}:${input.requestId}`],
  );
  if (!locked.rows[0]?.locked) throw new DomainError('conflict', 'Comando em andamento');
  await client.query(
    `DELETE FROM company_command_receipts
     WHERE tenant_id = $1 AND actor_id = $2 AND expires_at <= now()`,
    [input.tenantId, input.actorId],
  );
  const existing = await client.query<{ payload_hash: string; status: 'in_flight' | 'applied'; applied_at: Date | null }>(
    `SELECT payload_hash, status, applied_at
     FROM company_command_receipts
     WHERE tenant_id = $1 AND actor_id = $2 AND request_id = $3`,
    [input.tenantId, input.actorId, input.requestId],
  );
  const receipt = existing.rows[0];
  if (receipt) {
    if (receipt.payload_hash !== input.payloadHash) {
      throw new DomainError('conflict', 'Comando já usado com outro conteúdo');
    }
    if (receipt.status !== 'applied' || !receipt.applied_at) {
      throw new DomainError('conflict', 'Comando em andamento');
    }
    return { replayed: true, appliedAt: receipt.applied_at.toISOString() };
  }
  await client.query(
    `INSERT INTO company_command_receipts (
       tenant_id, actor_id, request_id, command_kind, payload_hash, status, expires_at
     ) VALUES ($1, $2, $3, $4, $5, 'in_flight', now() + interval '24 hours')`,
    [input.tenantId, input.actorId, input.requestId, input.commandKind, input.payloadHash],
  );
  await apply();
  const applied = await client.query<{ applied_at: Date }>(
    `UPDATE company_command_receipts
     SET status = 'applied', applied_at = now()
     WHERE tenant_id = $1 AND actor_id = $2 AND request_id = $3
     RETURNING applied_at`,
    [input.tenantId, input.actorId, input.requestId],
  );
  const appliedAt = applied.rows[0]?.applied_at;
  if (!appliedAt) throw new DomainError('internal', 'Recibo não confirmado');
  return { replayed: false, appliedAt: appliedAt.toISOString() };
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value).sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}
