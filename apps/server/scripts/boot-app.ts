import { createSMAdapter } from '@viavoip/sm-adapter';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { migrateWithRetry } from '../src/db/migrate.js';
import { seed } from '../src/db/seed.js';

const config = loadConfig();
const sm = createSMAdapter(config.smAdapter);
await migrateWithRetry(config.migrateDatabaseUrl);
if (config.seed) await seed(config.migrateDatabaseUrl);
const { app } = await buildApp(config, sm, {
  revoke: {
    notify: !process.argv.includes('--no-notify'),
    direct: !process.argv.includes('--no-direct'),
    sweepEnabled: !process.argv.includes('--no-sweep'),
  },
});

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
