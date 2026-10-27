import type { Pool } from 'pg';

export class SharedLoginRateLimiter {
  constructor(private readonly pool: Pool, private readonly windowMs: number) {}

  async allow(keys: string[], limit: number): Promise<boolean> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      let allowed = true;
      for (const keyHash of [...new Set(keys)].sort()) {
        const result = await client.query<{ attempts: number }>(
          `INSERT INTO login_rate_limits (key_hash, window_started_at, attempts)
           VALUES ($1, now(), 1)
           ON CONFLICT (key_hash) DO UPDATE
           SET attempts = CASE
                 WHEN login_rate_limits.window_started_at <= now() - ($3::double precision * interval '1 millisecond') THEN 1
                 ELSE LEAST(login_rate_limits.attempts + 1, $2 + 1)
               END,
               window_started_at = CASE
                 WHEN login_rate_limits.window_started_at <= now() - ($3::double precision * interval '1 millisecond') THEN now()
                 ELSE login_rate_limits.window_started_at
               END
           RETURNING attempts`,
          [keyHash, limit, this.windowMs],
        );
        if (Number(result.rows[0]?.attempts ?? limit + 1) > limit) allowed = false;
      }
      await client.query('COMMIT');
      return allowed;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async sweepExpired(): Promise<void> {
    await this.pool.query(
      `DELETE FROM login_rate_limits
       WHERE window_started_at < now() - ($1::double precision * interval '1 millisecond')`,
      [this.windowMs],
    );
  }
}
