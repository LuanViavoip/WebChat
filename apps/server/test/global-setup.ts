import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { migrate } from '../src/db/migrate.js';
import { seed } from '../src/db/seed.js';

let container: StartedPostgreSqlContainer | undefined;

export default async function setup(): Promise<() => Promise<void>> {
  container = await new PostgreSqlContainer('postgres:16-alpine')
    .withDatabase('webchat')
    .withUsername('postgres')
    .withPassword('postgres')
    .start();
  const migrateDatabaseUrl = container.getConnectionUri();
  const databaseUrl = new URL(migrateDatabaseUrl);
  databaseUrl.username = 'webchat_app';
  databaseUrl.password = 'webchat_app';
  await migrate(migrateDatabaseUrl);
  await seed(migrateDatabaseUrl);
  const metaPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '.pg-meta.json');
  writeFileSync(
    metaPath,
    JSON.stringify({ databaseUrl: databaseUrl.toString(), migrateDatabaseUrl }),
  );
  return async () => {
    await container?.stop();
  };
}
