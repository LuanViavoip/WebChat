import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const metaPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '.pg-meta.json');
const meta = JSON.parse(readFileSync(metaPath, 'utf8')) as {
  databaseUrl: string;
  migrateDatabaseUrl: string;
};

process.env.DATABASE_URL = meta.databaseUrl;
process.env.MIGRATE_DATABASE_URL = meta.migrateDatabaseUrl;
process.env.SM_ADAPTER = 'mock';
process.env.SEED = 'false';
process.env.SERVE_STATIC = 'false';
process.env.LOG = 'false';
process.env.REDIS_URL = '';
