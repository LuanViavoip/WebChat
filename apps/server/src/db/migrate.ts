import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import { migrationsDirectory } from '../paths.js';

const { Client } = pg;

export async function migrate(connectionString: string): Promise<void> {
  const client = new Client({ connectionString });
  await client.connect();
  try {
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      version text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )`);
    const applied = await client.query<{ version: string }>('SELECT version FROM schema_migrations');
    const versions = new Set(applied.rows.map((row) => row.version));
    const files = readdirSync(migrationsDirectory)
      .filter((file) => file.endsWith('.sql'))
      .sort();
    for (const file of files) {
      if (versions.has(file)) continue;
      const sql = readFileSync(path.join(migrationsDirectory, file), 'utf8');
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (version) VALUES ($1)', [file]);
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    }
  } finally {
    await client.end();
  }
}

export async function migrateWithRetry(connectionString: string, attempts = 30): Promise<void> {
  let last: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await migrate(connectionString);
      return;
    } catch (error) {
      last = error;
      await new Promise((resolve) => {
        setTimeout(resolve, 500);
      });
    }
  }
  throw last;
}
