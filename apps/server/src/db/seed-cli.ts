import { loadConfig } from '../config.js';
import { seed } from './seed.js';

const config = loadConfig();
await seed(config.migrateDatabaseUrl);
