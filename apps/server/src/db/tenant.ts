import type { Pool, PoolClient } from 'pg';

const tenantIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function withTenant<T>(
  pool: Pool,
  tenantId: string,
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  if (!tenantIdPattern.test(tenantId)) {
    throw new Error('Tenant da sessão inválido');
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantId]);
    const value = await fn(client);
    await client.query('COMMIT');
    return value;
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // A conexão já pode ter sido invalidada.
    }
    throw error;
  } finally {
    client.release();
  }
}

export async function withTenantAdvisoryLock<T>(
  pool: Pool,
  tenantId: string,
  lockKey: string,
  fn: (client: PoolClient) => Promise<T>,
  afterCommit?: (value: T) => Promise<void>,
): Promise<T> {
  if (!tenantIdPattern.test(tenantId)) throw new Error('Tenant da sessão inválido');
  const client = await pool.connect();
  let locked = false;
  let inTransaction = false;
  let discardConnection = false;
  try {
    await client.query('SELECT pg_advisory_lock(hashtextextended($1, 0))', [lockKey]);
    locked = true;
    await client.query('BEGIN');
    inTransaction = true;
    await client.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantId]);
    const value = await fn(client);
    await client.query('COMMIT');
    inTransaction = false;
    if (afterCommit) await afterCommit(value);
    return value;
  } catch (error) {
    if (inTransaction) {
      try {
        await client.query('ROLLBACK');
      } catch {
        // The connection may already have been invalidated.
      }
    }
    throw error;
  } finally {
    if (locked) {
      try {
        await client.query('SELECT pg_advisory_unlock(hashtextextended($1, 0))', [lockKey]);
      } catch {
        // Discarding the connection guarantees the session lock is released.
        discardConnection = true;
      }
    }
    client.release(discardConnection ? new Error('Falha ao liberar advisory lock') : undefined);
  }
}
