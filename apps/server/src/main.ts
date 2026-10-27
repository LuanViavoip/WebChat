import { createSMAdapter } from '@viavoip/sm-adapter';
import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { migrateWithRetry } from './db/migrate.js';
import { seed } from './db/seed.js';

const config = loadConfig();
const sm = createSMAdapter(config.smAdapter);
await migrateWithRetry(config.migrateDatabaseUrl);
if (config.seed) await seed(config.migrateDatabaseUrl);
const { app } = await buildApp(config, sm);

const shutdown = async () => {
  await app.close();
};

process.on('SIGINT', () => {
  void shutdown().then(() => process.exit(0));
});
process.on('SIGTERM', () => {
  void shutdown().then(() => process.exit(0));
});

await app.listen({ port: config.port, host: config.host });
