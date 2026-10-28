export type AppConfig = {
  databaseUrl: string;
  migrateDatabaseUrl: string;
  redisUrl: string | null;
  smAdapter: string;
  port: number;
  host: string;
  seed: boolean;
  sessionTtlHours: number;
  sessionCreateLimit: number;
  loginLimit: number;
  loginRateLimitSecret: string;
  messageLimit: number;
  rateWindowMs: number;
  presenceStaleMs: number;
  replicaCount: number;
  sessionRevokeSweepMs: number;
  corsOrigins: string[];
  serveStatic: boolean;
  logger: boolean;
};

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]?.trim();
  if (!value) throw new Error(`Variável obrigatória ausente: ${name}`);
  return value;
}

function sweepMs(env: NodeJS.ProcessEnv): number {
  const value = integer(env, 'SESSION_REVOKE_SWEEP_MS', 10_000);
  const allowSlow = env.NODE_ENV === 'test' || env.ALLOW_SLOW_REVOKE_SWEEP === 'true';
  if (value > 15_000 && !allowSlow) {
    throw new Error('SESSION_REVOKE_SWEEP_MS não pode passar de 15 segundos');
  }
  return value;
}

function integer(env: NodeJS.ProcessEnv, name: string, fallback: number): number {
  const raw = env[name]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`Variável ${name} deve ser um inteiro positivo`);
  }
  return value;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const databaseUrl = required(env, 'DATABASE_URL');
  const loginRateLimitSecret = required(env, 'LOGIN_RATE_LIMIT_SECRET');
  if (loginRateLimitSecret.length < 32) {
    throw new Error('Variável LOGIN_RATE_LIMIT_SECRET deve ter ao menos 32 caracteres');
  }
  const redisUrl = env.REDIS_URL?.trim() || null;
  const replicaCount = integer(env, 'REPLICAS', 1);
  if (replicaCount > 1 && !redisUrl) {
    throw new Error('REDIS_URL é obrigatório com mais de uma réplica');
  }
  const cors = (env.CORS_ORIGINS ?? 'http://localhost:3000,http://127.0.0.1:3000')
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
  return {
    databaseUrl,
    migrateDatabaseUrl: required(env, 'MIGRATE_DATABASE_URL'),
    redisUrl,
    smAdapter: required(env, 'SM_ADAPTER'),
    port: integer(env, 'PORT', 3000),
    host: env.HOST?.trim() || '0.0.0.0',
    seed: env.SEED === 'true',
    sessionTtlHours: integer(env, 'SESSION_TTL_HOURS', 12),
    sessionCreateLimit: integer(env, 'SESSION_CREATE_LIMIT', 1000),
    loginLimit: integer(env, 'LOGIN_LIMIT', 20),
    loginRateLimitSecret,
    messageLimit: integer(env, 'MESSAGE_LIMIT', 1000),
    rateWindowMs: integer(env, 'RATE_WINDOW_MS', 60_000),
    presenceStaleMs: integer(env, 'PRESENCE_STALE_MS', 45_000),
    replicaCount,
    sessionRevokeSweepMs: sweepMs(env),
    corsOrigins: cors,
    serveStatic: env.SERVE_STATIC !== 'false',
    logger: env.LOG !== 'false',
  };
}
