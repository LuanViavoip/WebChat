import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { io, type Socket } from 'socket.io-client';
import { demoAccounts, demoIds, demoPassword, demoSites } from '../src/demo/ids.js';

const serverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const migrateUrl = process.env.MIGRATE_DATABASE_URL ?? 'postgres://postgres:postgres@127.0.0.1:5432/webchat';
const databaseUrl = process.env.DATABASE_URL ?? 'postgres://webchat_app:webchat_app@127.0.0.1:5432/webchat';
const redisUrl = process.env.REDIS_URL ?? 'redis://127.0.0.1:6379';
const secret = process.env.LOGIN_RATE_LIMIT_SECRET ?? 'local-only-shared-login-rate-limit-secret-change-before-deploy';
const parentOrigin = 'http://localhost:8090';
const children: ChildProcess[] = [];

function log(title: string, value: unknown): void {
  console.log(`\n== ${title}`);
  console.log(typeof value === 'string' ? value : JSON.stringify(value, null, 2));
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function postJson(url: string, body: unknown, token?: string) {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (token) headers.authorization = `Bearer ${token}`;
  const response = await fetch(url, { method: 'POST', body: JSON.stringify(body), headers });
  const text = await response.text();
  return { status: response.status, text, payload: text ? (JSON.parse(text) as unknown) : null };
}

async function login(baseUrl: string, email: string): Promise<string> {
  const response = await postJson(`${baseUrl}/auth/login`, { email, password: demoPassword });
  assert(response.status === 200, `login ${email} ${response.status} ${response.text}`);
  return (response.payload as { token: string }).token;
}

function connect(baseUrl: string, namespace: string, token: string): Socket {
  return io(`${baseUrl}${namespace}`, {
    auth: { token },
    transports: ['websocket'],
    reconnection: false,
    forceNew: true,
  });
}

function waitConnect(socket: Socket): Promise<void> {
  if (socket.connected) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout de conexão')), 5000);
    socket.once('connect', () => {
      clearTimeout(timer);
      resolve();
    });
    socket.once('connect_error', (error: Error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

function emitAck(socket: Socket, event: string, payload: unknown = {}): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout ${event}`)), 5000);
    socket.emit(event, payload, (response: Record<string, unknown>) => {
      clearTimeout(timer);
      resolve(response);
    });
  });
}

function waitEvent(socket: Socket, event: string, timeoutMs: number): Promise<unknown | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), timeoutMs);
    socket.once(event, (payload: unknown) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
}

function signalTree(child: ChildProcess, signal: NodeJS.Signals): void {
  if (!child.pid) return;
  try {
    process.kill(-child.pid, signal);
  } catch {
    try {
      child.kill(signal);
    } catch {
      // O processo já encerrou.
    }
  }
}

async function stopAll(): Promise<void> {
  await Promise.all(children.map(async (child) => {
    if (child.exitCode !== null) return;
    signalTree(child, 'SIGTERM');
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        signalTree(child, 'SIGKILL');
        resolve();
      }, 4000);
      child.once('exit', () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }));
  children.length = 0;
}

function startServer(port: number, mode: 'redis' | 'notify'): ChildProcess {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    DATABASE_URL: databaseUrl,
    MIGRATE_DATABASE_URL: migrateUrl,
    SM_ADAPTER: 'mock',
    SEED: 'false',
    LOGIN_RATE_LIMIT_SECRET: secret,
    SESSION_REVOKE_SWEEP_MS: '120000',
    HOST: '127.0.0.1',
    PORT: String(port),
    SERVE_STATIC: 'false',
    LOG: 'false',
  };
  if (mode === 'redis') {
    env.REDIS_URL = redisUrl;
    env.REPLICAS = '2';
    env.SESSION_REVOKE_NOTIFY = 'false';
    env.SESSION_REVOKE_DIRECT = 'true';
  } else {
    delete env.REDIS_URL;
    env.REPLICAS = '1';
    env.SESSION_REVOKE_NOTIFY = 'true';
    env.SESSION_REVOKE_DIRECT = 'false';
  }
  const child = spawn('pnpm', ['exec', 'tsx', 'src/main.ts'], {
    cwd: serverRoot,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  });
  children.push(child);
  return child;
}

async function waitHealthy(baseUrl: string): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < 30_000) {
    try {
      const response = await fetch(`${baseUrl}/health`);
      if (response.ok) return;
    } catch {
      // A instância ainda está abrindo o banco.
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`servidor ${baseUrl} não ficou saudável`);
}

async function listenerCount(): Promise<number> {
  const admin = new pg.Client({ connectionString: migrateUrl });
  await admin.connect();
  try {
    const rows = await admin.query<{ total: number }>(
      `SELECT count(*)::int AS total FROM pg_stat_activity WHERE query ILIKE '%webchat_session_revoke%'`,
    );
    return rows.rows[0]?.total ?? 0;
  } finally {
    await admin.end();
  }
}

async function epoch(): Promise<number> {
  const admin = new pg.Client({ connectionString: migrateUrl });
  await admin.connect();
  try {
    const rows = await admin.query<{ auth_epoch: number }>(`SELECT auth_epoch FROM agents WHERE id = $1`, [demoIds.agentBruno]);
    return Number(rows.rows[0]?.auth_epoch ?? 0);
  } finally {
    await admin.end();
  }
}

async function exercise(label: string, revokeUrl: string, socketUrl: string): Promise<void> {
  const before = await epoch();
  const brunoToken = await login(revokeUrl, demoAccounts.bruno);
  const carlaToken = await login(socketUrl, demoAccounts.carla);
  const bruno = connect(socketUrl, '/agent', brunoToken);
  const carla = connect(socketUrl, '/agent', carlaToken);
  await Promise.all([waitConnect(bruno), waitConnect(carla)]);
  assert((await emitAck(bruno, 'queue.subscribe', {})).ok === true, 'Bruno não entrou nas filas');
  assert((await emitAck(carla, 'internal.list', {})).ok === true, 'Carla não entrou no chat interno');
  const missed = waitEvent(bruno, 'conversation.updated', 8_000);
  const dropped = waitEvent(bruno, 'disconnect', 8_000);
  const otavio = await login(revokeUrl, demoAccounts.otavio);
  const started = Date.now();
  const revokedPromise = postJson(`${revokeUrl}/company/commands`, {
    requestId: randomUUID(),
    command: { kind: 'agent.sessions_revoke', agentId: demoIds.agentBruno },
  }, otavio);
  const droppedPayload = await dropped;
  const elapsedMs = Date.now() - started;
  const revoked = await revokedPromise;
  assert(revoked.status === 200, `revogação ${label} devolveu ${revoked.status} ${revoked.text}`);
  assert(droppedPayload, `${label}: o socket não caiu`);
  assert(elapsedMs < 8_000, `${label}: queda em ${elapsedMs}ms, dentro da varredura de 120s`);
  assert(bruno.connected === false, `${label}: socket ainda conectado`);
  const visitor = await postJson(`${socketUrl}/visitor/sessions`, { sitePublicId: demoSites.a, parentOrigin });
  assert(visitor.status === 200, `visitante ${visitor.status}`);
  const visitorSocket = connect(socketUrl, '/visitor', (visitor.payload as { token: string }).token);
  await waitConnect(visitorSocket);
  const opened = await emitAck(visitorSocket, 'conversation.start', { queueId: demoIds.queueSupportA });
  assert(opened.ok === true, `abertura ${JSON.stringify(opened)}`);
  const leaked = await Promise.race([
    missed.then((payload) => payload),
    new Promise((resolve) => setTimeout(() => resolve(null), 1_000)),
  ]);
  assert(leaked === null, `${label}: o socket revogado ainda recebeu evento da fila`);
  const refused = await new Promise<string>((resolve) => {
    const again = connect(socketUrl, '/agent', brunoToken);
    const timer = setTimeout(() => resolve('sem recusa'), 4000);
    again.once('connect', () => {
      clearTimeout(timer);
      again.disconnect();
      resolve('reconectou');
    });
    again.once('connect_error', (error: Error) => {
      clearTimeout(timer);
      resolve(error.message);
    });
  });
  assert(refused !== 'reconectou' && refused !== 'sem recusa', `${label}: token revogado reentrou (${refused})`);
  assert(carla.connected, `${label}: Carla caiu junto`);
  assert((await emitAck(carla, 'internal.list', {})).ok === true, `${label}: Carla saiu das rooms`);
  const after = await epoch();
  log(label, { elapsedMs, epochAntes: before, epochDepois: after, recusa: refused, carlaConectada: carla.connected });
  assert(after === before + 1, `${label}: auth_epoch não avançou`);
  visitorSocket.disconnect();
  carla.disconnect();
}

async function main(): Promise<void> {
  const baseline = await listenerCount();
  startServer(3200, 'redis');
  startServer(3201, 'redis');
  await Promise.all([waitHealthy('http://127.0.0.1:3200'), waitHealthy('http://127.0.0.1:3201')]);
  const redisListeners = await listenerCount();
  log('listeners com Redis e NOTIFY desligado', { antes: baseline, durante: redisListeners });
  assert(redisListeners === baseline, `as instâncias Redis abriram ${redisListeners - baseline} listeners`);
  await exercise('redis sem NOTIFY', 'http://127.0.0.1:3200', 'http://127.0.0.1:3201');
  await stopAll();

  const afterRedis = await listenerCount();
  startServer(3202, 'notify');
  await waitHealthy('http://127.0.0.1:3202');
  const notifyListeners = await listenerCount();
  log('listeners sem Redis, só NOTIFY', { antes: afterRedis, durante: notifyListeners });
  assert(notifyListeners === afterRedis + 1, 'o listener de NOTIFY não subiu sozinho');
  await exercise('NOTIFY sem Redis', 'http://127.0.0.1:3202', 'http://127.0.0.1:3202');
  log('veredito da revogação', 'os dois caminhos isolados derrubaram o socket fora da varredura');
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => {
    void stopAll();
  });
