import { readFileSync } from 'node:fs';
import pg from 'pg';
import { hashPassword } from '../auth/passwords.js';
import { demoPassword } from '../demo/ids.js';
import { seedFile } from '../paths.js';

const { Client } = pg;

export async function seed(connectionString: string): Promise<void> {
  const passwordHash = await hashPassword(demoPassword);
  const sql = readFileSync(seedFile, 'utf8').replaceAll('__DEMO_PASSWORD_HASH__', passwordHash);
  const client = new Client({ connectionString });
  await client.connect();
  try {
    await client.query('BEGIN');
    try {
      await client.query(sql);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  } finally {
    await client.end();
  }
}
