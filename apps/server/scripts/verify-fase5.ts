import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { io, type Socket } from 'socket.io-client';
import { resolveAcceptance } from '../src/domain/acceptance.js';
import { migrate } from '../src/db/migrate.js';
import { seed } from '../src/db/seed.js';
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

async function getJson(url: string, token?: string) {
  const headers: Record<string, string> = {};
  if (token) headers.authorization = `Bearer ${token}`;
  const response = await fetch(url, { headers });
  const text = await response.text();
  return { status: response.status, text, payload: text ? (JSON.parse(text) as unknown) : null };
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
  assert(response.status === 200, `login ${email} devolveu ${response.status} ${response.text}`);
  const payload = response.payload as { token: string };
  return payload.token;
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

const serverLogs = new Map<ChildProcess, string>();

function startServer(port: number): ChildProcess {
  const child = spawn('pnpm', ['exec', 'tsx', 'scripts/boot-app.ts', '--no-sweep'], {
    cwd: serverRoot,
    env: {
      ...process.env,
      DATABASE_URL: databaseUrl,
      MIGRATE_DATABASE_URL: migrateUrl,
      REDIS_URL: redisUrl,
      SM_ADAPTER: 'mock',
      SEED: 'false',
      LOGIN_RATE_LIMIT_SECRET: secret,
      REPLICAS: '2',
      HOST: '127.0.0.1',
      PORT: String(port),
      SERVE_STATIC: 'false',
      LOG: 'false',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  });
  serverLogs.set(child, '');
  child.stderr?.on('data', (chunk: Buffer) => {
    const next = `${serverLogs.get(child) ?? ''}${chunk.toString()}`;
    serverLogs.set(child, next.slice(-4000));
  });
  children.push(child);
  return child;
}

async function waitHealthy(baseUrl: string): Promise<void> {
  const started = Date.now();
  let last = '';
  while (Date.now() - started < 30_000) {
    try {
      const response = await fetch(`${baseUrl}/health`);
      if (response.ok) return;
      last = `status ${response.status}`;
    } catch (error) {
      last = error instanceof Error ? error.message : 'sem conexão';
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  const logs = children.map((child) => serverLogs.get(child) ?? '').join('\n');
  throw new Error(`servidor ${baseUrl} não ficou saudável: ${last}\n${logs}`);
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

async function stopServer(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode) return;
  signalTree(child, 'SIGTERM');
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      signalTree(child, 'SIGKILL');
      resolve();
    }, 5000);
    child.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

async function prepareDatabase(): Promise<void> {
  await migrate(migrateUrl);
  const admin = new pg.Client({ connectionString: migrateUrl });
  await admin.connect();
  try {
    const versions = await admin.query<{ version: string }>('SELECT version FROM schema_migrations ORDER BY version');
    log('migrations aplicadas', versions.rows.map((row) => row.version));
    const rls = await admin.query(
      `SELECT relname, relrowsecurity, relforcerowsecurity
       FROM pg_class
       WHERE relname IN ('sla_policies', 'sla_policy_clocks', 'site_service_windows', 'company_command_receipts')
       ORDER BY relname`,
    );
    log('RLS das tabelas da fase 5', rls.rows);
    const columns = await admin.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_name = 'company_command_receipts' ORDER BY ordinal_position`,
    );
    log('colunas do recibo', columns.rows.map((row: { column_name: string }) => row.column_name));
    const tenants = await admin.query<{ total: number }>('SELECT count(*)::int AS total FROM tenants');
    if ((tenants.rows[0]?.total ?? 0) === 0) await seed(migrateUrl);
  } finally {
    await admin.end();
  }
}

async function regression(primary: string): Promise<void> {
  const widget = await getJson(`${primary}/public/widgets/${demoSites.a}`);
  assert(widget.status === 200, `widget público ${widget.status}`);
  log('widget público', widget.payload);
  const anaToken = await login(primary, demoAccounts.ana);
  const carlaToken = await login(primary, demoAccounts.carla);
  const sofiaToken = await login(primary, demoAccounts.sofia);
  const renataToken = await login(primary, demoAccounts.renata);
  const ana = connect(primary, '/agent', anaToken);
  const carla = connect(primary, '/agent', carlaToken);
  const sofia = connect(primary, '/supervisor', sofiaToken);
  const renata = connect(primary, '/supervisor', renataToken);
  await Promise.all([waitConnect(ana), waitConnect(carla), waitConnect(sofia), waitConnect(renata)]);
  assert((await emitAck(ana, 'queue.subscribe', {})).ok === true, 'Ana não entrou na fila');
  assert((await emitAck(carla, 'queue.subscribe', {})).ok === true, 'Carla não entrou na fila');
  const visitor = await postJson(`${primary}/visitor/sessions`, { sitePublicId: demoSites.a, parentOrigin });
  assert(visitor.status === 200, `sessão do visitante ${visitor.status} ${visitor.text}`);
  const visitorToken = (visitor.payload as { token: string }).token;
  const visitorSocket = connect(primary, '/visitor', visitorToken);
  await waitConnect(visitorSocket);
  const anaSaw = waitEvent(ana, 'conversation.updated', 5000);
  const carlaSaw = waitEvent(carla, 'conversation.updated', 1500);
  const started = await emitAck(visitorSocket, 'conversation.start', { queueId: demoIds.queueSupportA });
  assert(started.ok === true, `abertura recusada: ${JSON.stringify(started)}`);
  const seenByAna = await anaSaw;
  const seenByCarla = await carlaSaw;
  assert(seenByAna, 'Ana não recebeu a conversa da própria empresa');
  assert(seenByCarla === null, 'Carla recebeu evento da empresa A');
  const conversationId = (seenByAna as { id: string }).id;
  const claimed = await emitAck(ana, 'conversation.claim', { conversationId });
  assert(claimed.ok === true, `claim recusado: ${JSON.stringify(claimed)}`);
  const sent = await emitAck(ana, 'message.send', { conversationId, requestId: randomUUID(), body: 'olá do verificador' });
  assert(sent.ok === true, `mensagem recusada: ${JSON.stringify(sent)}`);
  const internal = await emitAck(ana, 'internal.list', {});
  assert(internal.ok === true, 'chat interno indisponível');
  const sectors = await emitAck(sofia, 'sector.list', {});
  const renataSectors = await emitAck(renata, 'sector.list', {});
  assert(sectors.ok === true && renataSectors.ok === true, 'lista de setores falhou');
  const sectorText = JSON.stringify(sectors);
  const renataText = JSON.stringify(renataSectors);
  assert(sectorText.includes('Suporte Técnico') && !renataText.includes(demoIds.sectorSupportA), 'setores vazaram entre empresas');
  const activities = await emitAck(ana, 'activity.catalog', {});
  assert(activities.ok === true, 'catálogo de atividades falhou');
  const snapshot = await emitAck(sofia, 'supervisor.snapshot', {});
  const renataSnapshot = await emitAck(renata, 'supervisor.snapshot', {});
  assert(snapshot.ok === true && renataSnapshot.ok === true, 'painel do supervisor falhou');
  assert(JSON.stringify(snapshot).includes('Ana Lima'), 'painel da Sofia não vê Ana');
  assert(!JSON.stringify(snapshot).includes('Carla Dias'), 'painel da Sofia vê Carla');
  assert(JSON.stringify(renataSnapshot).includes('Carla Dias'), 'painel da Renata não vê Carla');
  assert(!JSON.stringify(renataSnapshot).includes('Ana Lima'), 'painel da Renata vê Ana');
  log('regressão', { widget: widget.status, conversa: conversationId, chatInterno: true, setores: true, atividades: true, supervisor: true });
  for (const socket of [ana, carla, sofia, renata, visitorSocket]) socket.disconnect();
}

async function permissionsAndIsolation(primary: string): Promise<void> {
  const otavio = await login(primary, demoAccounts.otavio);
  const ana = await login(primary, demoAccounts.ana);
  const sofia = await login(primary, demoAccounts.sofia);
  const missing = await getJson(`${primary}/company/desk`);
  assert(missing.status === 401, `sem token deveria ser 401, veio ${missing.status}`);
  const visitor = await postJson(`${primary}/visitor/sessions`, { sitePublicId: demoSites.a, parentOrigin });
  const visitorToken = (visitor.payload as { token: string }).token;
  assert((await getJson(`${primary}/audit/events`, visitorToken)).status === 401, 'visitante chegou à auditoria');
  for (const token of [ana, sofia]) {
    assert((await getJson(`${primary}/company/desk`, token)).status === 403, 'papel sem gestão leu a mesa');
    assert((await getJson(`${primary}/audit/events`, token)).status === 403, 'papel sem gestão leu a auditoria');
    const denied = await postJson(`${primary}/company/commands`, {
      requestId: randomUUID(),
      command: { kind: 'company.rename', name: 'Não' },
    }, token);
    assert(denied.status === 403, `comando sem permissão devolveu ${denied.status}`);
  }
  const from = '2026-04-01T00:00:00.000Z';
  const to = '2026-04-02T00:00:00.000Z';
  const quality = (queueId: string) =>
    `${primary}/quality/report?scopeKind=queue&queueId=${queueId}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
  assert((await getJson(`${primary}/quality/report?scopeKind=tenant&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`, sofia)).status === 403, 'supervisora leu o tenant');
  assert((await getJson(quality(demoIds.queueSalesA), sofia)).status === 403, 'supervisora leu fila de outro setor');
  assert((await getJson(quality(demoIds.queueSupportA), sofia)).status === 200, 'supervisora não leu a própria fila');
  const desk = await getJson(`${primary}/company/desk`, otavio);
  assert(desk.status === 200 && (desk.payload as { company: { slug: string } }).company.slug === 'tenant-a', 'mesa não é a da empresa A');
  assert(!desk.text.includes(demoIds.queueSupportB), 'mesa da empresa A lista fila da B');
  const poisoned = await postJson(`${primary}/company/commands`, {
    requestId: randomUUID(),
    command: { kind: 'company.rename', name: 'Tenant A', tenantId: demoIds.tenantB },
  }, otavio);
  assert(poisoned.status === 400, `tenantId no corpo devolveu ${poisoned.status}`);
  const foreign = await postJson(`${primary}/company/commands`, {
    requestId: randomUUID(),
    command: { kind: 'queue.rename', queueId: demoIds.queueSupportB, name: 'Invadida' },
  }, otavio);
  assert(foreign.status === 404, `fila da outra empresa devolveu ${foreign.status}`);
  assert((await getJson(quality(demoIds.queueSupportB), otavio)).status === 404, 'relatório da fila estrangeira não foi not_found');
  log('permissões e isolamento HTTP', { semToken: 401, agente: 403, supervisoraFora: 403, supervisoraPropria: 200, outraEmpresa: 404 });
}

async function idempotency(primary: string, restart: () => Promise<string>): Promise<void> {
  const token = await login(primary, demoAccounts.otavio);
  const requestId = randomUUID();
  const command = { kind: 'queue.create', name: `Fila verificação ${requestId.slice(0, 8)}` };
  const raced = await Promise.all([
    postJson(`${primary}/company/commands`, { requestId, command }, token),
    postJson(`${primary}/company/commands`, { requestId, command }, token),
  ]);
  log('idempotência concorrente', raced.map((item) => ({
    status: item.status,
    replayed: (item.payload as { receipt?: { replayed: boolean } } | null)?.receipt?.replayed ?? null,
    error: (item.payload as { error?: { code: string; message: string } } | null)?.error ?? null,
  })));
  const created = raced.filter((item) => item.status === 200 && (item.payload as { receipt: { replayed: boolean } }).receipt.replayed === false);
  assert(created.length === 1, `esperado um efeito, vieram ${created.length}`);
  const next = await restart();
  const again = await login(next, demoAccounts.otavio);
  const replay = await postJson(`${next}/company/commands`, { requestId, command }, again);
  log('idempotência depois do restart', (replay.payload as { receipt: unknown }).receipt);
  assert(replay.status === 200, `replay devolveu ${replay.status} ${replay.text}`);
  assert((replay.payload as { receipt: { replayed: boolean } }).receipt.replayed === true, 'restart não marcou replayed');
  const admin = new pg.Client({ connectionString: migrateUrl });
  await admin.connect();
  try {
    const rows = await admin.query(`SELECT id FROM queues WHERE name = $1`, [command.name]);
    const audits = await admin.query(`SELECT id FROM audit_events WHERE action = 'queue.create' AND resource_id = $1`, [rows.rows[0]?.id]);
    assert(rows.rows.length === 1 && audits.rows.length === 1, 'o pedido criou mais de uma fila ou auditoria');
  } finally {
    await admin.end();
  }
}

async function revokeAcrossReplicas(primary: string, secondary: string): Promise<void> {
  const bruno = await login(primary, demoAccounts.bruno);
  const carla = await login(secondary, demoAccounts.carla);
  const brunoSocket = connect(secondary, '/agent', bruno);
  const carlaSocket = connect(secondary, '/agent', carla);
  await Promise.all([waitConnect(brunoSocket), waitConnect(carlaSocket)]);
  const started = Date.now();
  const dropped = waitEvent(brunoSocket, 'disconnect', 5000);
  const otavio = await login(primary, demoAccounts.otavio);
  const revoked = await postJson(`${primary}/company/commands`, {
    requestId: randomUUID(),
    command: { kind: 'agent.sessions_revoke', agentId: demoIds.agentBruno },
  }, otavio);
  assert(revoked.status === 200, `revogação devolveu ${revoked.status} ${revoked.text}`);
  assert(await dropped, 'socket da outra instância não caiu');
  const elapsed = Date.now() - started;
  assert(elapsed < 5000, `queda demorou ${elapsed}ms`);
  assert(carlaSocket.connected, 'revogação derrubou socket de outra empresa');
  const admin = new pg.Client({ connectionString: databaseUrl });
  await admin.connect();
  try {
    await admin.query(`SELECT set_config('app.tenant_id', $1, false)`, [demoIds.tenantA]);
    const epoch = await admin.query<{ auth_epoch: number }>(`SELECT auth_epoch FROM agents WHERE id = $1`, [demoIds.agentBruno]);
    log('revogação entre réplicas', { elapsedMs: elapsed, authEpoch: epoch.rows[0]?.auth_epoch, carlaConectada: carlaSocket.connected });
    assert((epoch.rows[0]?.auth_epoch ?? 0) > 1, 'auth_epoch não avançou');
  } finally {
    await admin.end();
  }
  carlaSocket.disconnect();
}

async function calendar(primary: string): Promise<void> {
  const spring = resolveAcceptance(
    { kind: 'accepting' },
    { kind: 'weekly', windows: [{ weekday: 7, startMinute: 210, endMinute: 720 }] },
    'America/New_York',
    '2026-03-08T06:00:00.000Z',
  );
  const gap = resolveAcceptance(
    { kind: 'accepting' },
    { kind: 'weekly', windows: [{ weekday: 7, startMinute: 150, endMinute: 720 }] },
    'America/New_York',
    '2026-03-08T06:00:00.000Z',
  );
  const fall = resolveAcceptance(
    { kind: 'accepting' },
    { kind: 'weekly', windows: [{ weekday: 7, startMinute: 150, endMinute: 240 }] },
    'America/New_York',
    '2026-11-01T05:30:00.000Z',
  );
  log('calendário com horário de verão', { spring, gap, fall });
  assert(spring.kind === 'outside_service_window' && spring.resumesAt === '2026-03-08T07:30:00.000Z', 'abertura depois da virada de março');
  assert(gap.kind === 'outside_service_window' && gap.resumesAt === '2026-03-08T07:00:00.000Z', 'vão das 02:30');
  assert(fall.kind === 'outside_service_window' && fall.resumesAt === '2026-11-01T07:30:00.000Z', 'retorno de novembro');
  const otavio = await login(primary, demoAccounts.otavio);
  const closed = await postJson(`${primary}/company/commands`, {
    requestId: randomUUID(),
    command: { kind: 'site.service_windows_replace', siteId: demoIds.siteA, calendar: { kind: 'weekly', windows: [{ weekday: 7, startMinute: 0, endMinute: 60 }] } },
  }, otavio);
  assert(closed.status === 200, `janela de domingo devolveu ${closed.status} ${closed.text}`);
  const visitor = await postJson(`${primary}/visitor/sessions`, { sitePublicId: demoSites.a, parentOrigin });
  const socket = connect(primary, '/visitor', (visitor.payload as { token: string }).token);
  await waitConnect(socket);
  const refused = await emitAck(socket, 'conversation.start', { queueId: demoIds.queueSupportA });
  log('abertura fora da janela', refused);
  assert(refused.ok === false && (refused.error as { code: string }).code === 'invalid_state', 'conversa abriu fora do calendário');
  socket.disconnect();
  const restored = await postJson(`${primary}/company/commands`, {
    requestId: randomUUID(),
    command: { kind: 'site.service_windows_replace', siteId: demoIds.siteA, calendar: { kind: 'always_open' } },
  }, otavio);
  assert(restored.status === 200, 'não restaurou o calendário sempre aberto');
}

async function qualityAndAudit(primary: string): Promise<void> {
  const admin = new pg.Client({ connectionString: migrateUrl });
  await admin.connect();
  const visitorId = randomUUID();
  const foreignVisitor = randomUUID();
  let oldAuditId = '';
  const conversationIds = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
  const older = randomUUID();
  const newer = randomUUID();
  const from = '2026-04-01T00:00:00.000Z';
  const to = '2026-04-02T00:00:00.000Z';
  try {
    await admin.query('ALTER TABLE sla_policies DISABLE TRIGGER sla_policies_publication');
    await admin.query('BEGIN');
    await admin.query(`INSERT INTO visitors (id, tenant_id, site_id) VALUES ($1, $2, $3)`, [
      visitorId, demoIds.tenantA, demoIds.siteA,
    ]);
    const samples = [
      { id: conversationIds[0], queue: demoIds.queueSupportA, tenant: demoIds.tenantA, site: demoIds.siteA, visitor: visitorId, queued: '2026-04-01T10:00:00.000Z', assigned: '2026-04-01T10:00:10.000Z', reply: '2026-04-01T10:00:15.000Z', closed: '2026-04-01T10:00:40.000Z', agent: demoIds.agentAna },
      { id: conversationIds[1], queue: demoIds.queueSupportA, tenant: demoIds.tenantA, site: demoIds.siteA, visitor: visitorId, queued: '2026-04-01T11:00:00.000Z', assigned: '2026-04-01T11:00:20.000Z', reply: '2026-04-01T11:00:50.000Z', closed: '2026-04-01T11:01:20.000Z', agent: demoIds.agentAna },
      { id: conversationIds[2], queue: demoIds.queueSupportA, tenant: demoIds.tenantA, site: demoIds.siteA, visitor: visitorId, queued: '2026-04-01T12:00:00.000Z', assigned: '2026-04-01T12:00:40.000Z', reply: '2026-04-01T12:00:55.000Z', closed: '2026-04-01T12:02:10.000Z', agent: demoIds.agentAna },
    ];
    for (const sample of samples) {
      await admin.query(
        `INSERT INTO conversations (id, tenant_id, site_id, queue_id, visitor_id, status, queued_at) VALUES ($1, $2, $3, $4, $5, 'closed', $6)`,
        [sample.id, sample.tenant, sample.site, sample.queue, sample.visitor, sample.queued],
      );
      await admin.query(
        `INSERT INTO conversation_events (tenant_id, conversation_id, type, payload, created_at) VALUES
           ($1, $2, 'queued', $3::jsonb, $4),
           ($1, $2, 'assigned', $5::jsonb, $6),
           ($1, $2, 'classified', $7::jsonb, $8)`,
        [sample.tenant, sample.id, JSON.stringify({ queueId: sample.queue }), sample.queued, JSON.stringify({ agentId: sample.agent }), sample.assigned, JSON.stringify({ dispositionId: demoIds.dispositionResolvedA }), sample.closed],
      );
      await admin.query(
        `INSERT INTO messages (tenant_id, conversation_id, sender_type, sender_id, request_id, body, created_at) VALUES ($1, $2, 'agent', $3, $4, 'ok', $5)`,
        [sample.tenant, sample.id, sample.agent, randomUUID(), sample.reply],
      );
    }
    await admin.query(`INSERT INTO visitors (id, tenant_id, site_id) VALUES ($1, $2, $3)`, [foreignVisitor, demoIds.tenantB, demoIds.siteB]);
    await admin.query(
      `INSERT INTO conversations (id, tenant_id, site_id, queue_id, visitor_id, status, queued_at) VALUES ($1, $2, $3, $4, $5, 'closed', $6)`,
      [conversationIds[3], demoIds.tenantB, demoIds.siteB, demoIds.queueSupportB, foreignVisitor, '2026-04-01T13:00:00.000Z'],
    );
    await admin.query(
      `INSERT INTO conversation_events (tenant_id, conversation_id, type, payload, created_at) VALUES
         ($1, $2, 'queued', $3::jsonb, '2026-04-01T13:00:00.000Z'),
         ($1, $2, 'assigned', $4::jsonb, '2026-04-01T13:16:39.000Z')`,
      [demoIds.tenantB, conversationIds[3], JSON.stringify({ queueId: demoIds.queueSupportB }), JSON.stringify({ agentId: demoIds.agentCarla })],
    );
    await admin.query(
      `INSERT INTO sla_policies (id, tenant_id, queue_id, status, effective_from, retired_at, created_by) VALUES
         ($1, $2, $3, 'retired', '2026-03-01T00:00:00.000Z', '2026-05-01T00:00:00.000Z', $4),
         ($5, $2, $3, 'active', '2026-05-01T00:00:00.000Z', NULL, $4)`,
      [older, demoIds.tenantA, demoIds.queueSupportA, demoIds.adminOtavio, newer],
    );
    await admin.query(
      `INSERT INTO sla_policy_clocks (policy_id, tenant_id, metric, threshold_seconds) VALUES
         ($1, $2, 'queue_wait', 15), ($1, $2, 'first_response', 25),
         ($3, $2, 'queue_wait', 1), ($3, $2, 'first_response', 1)`,
      [older, demoIds.tenantA, newer],
    );
    const oldAudit = await admin.query<{ id: string }>(
      `INSERT INTO audit_events (tenant_id, actor_id, action, resource_type, resource_id, metadata, created_at)
       VALUES ($1, $2, 'company.time_zone', 'tenant', $1, '{"password":"nao-mostrar"}'::jsonb, now() - interval '48 hours')
       RETURNING id`,
      [demoIds.tenantA, demoIds.adminOtavio],
    );
    oldAuditId = oldAudit.rows[0]?.id ?? '';
    await admin.query('COMMIT');
  } catch (error) {
    await admin.query('ROLLBACK');
    throw error;
  } finally {
    await admin.query('ALTER TABLE sla_policies ENABLE TRIGGER sla_policies_publication');
  }
  try {
    const otavio = await login(primary, demoAccounts.otavio);
    const report = await getJson(
      `${primary}/quality/report?scopeKind=queue&queueId=${demoIds.queueSupportA}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
      otavio,
    );
    log('relatório conferido à mão', report.payload);
    const body = report.payload as {
      queueWait: { samples: number; totalSeconds: number; averageSeconds: number; p50Seconds: number; p90Seconds: number };
      firstResponse: { samples: number; totalSeconds: number; p50Seconds: number; p90Seconds: number };
      handleTime: { totalSeconds: number; p50Seconds: number; p90Seconds: number };
      firstResponseCoverage: { answered: number };
      sla: { queueWait: { within: number; breached: number }; firstResponse: { within: number; breached: number } };
    };
    // Esperas 10, 20 e 40. n=3. p50 índice 1 = 20. p90 índice 2 = 40. Total 70.
    assert(body.queueWait.samples === 3 && body.queueWait.totalSeconds === 70 && body.queueWait.p50Seconds === 20 && body.queueWait.p90Seconds === 40, 'p50/p90 da espera');
    assert(body.queueWait.averageSeconds === 70 / 3, 'média da espera');
    // Respostas 5, 30 e 15. Ordenadas 5, 15, 30. p50 = 15. p90 = 30. Total 50.
    assert(body.firstResponse.samples === 3 && body.firstResponse.totalSeconds === 50 && body.firstResponse.p50Seconds === 15 && body.firstResponse.p90Seconds === 30, 'p50/p90 da primeira resposta');
    // Tratos 30, 60 e 90. p50 = 60. p90 = 90.
    assert(body.handleTime.totalSeconds === 180 && body.handleTime.p50Seconds === 60 && body.handleTime.p90Seconds === 90, 'p50/p90 do trato');
    assert(body.firstResponseCoverage.answered === 3, 'cobertura answered');
    // Limiar de março é 15/25. O limiar 1 de maio não rejulga abril: 10s continua dentro.
    assert(body.sla.queueWait.within === 1 && body.sla.queueWait.breached === 2, 'SLA de espera retroativo');
    assert(body.sla.firstResponse.within === 2 && body.sla.firstResponse.breached === 1, 'SLA de resposta retroativo');
    assert(!report.text.includes('999'), 'espera da empresa B entrou no relatório');
    const stamped = await postJson(`${primary}/company/commands`, {
      requestId: randomUUID(),
      command: { kind: 'company.time_zone', timeZone: 'America/Sao_Paulo' },
    }, otavio);
    assert(stamped.status === 200, `fuso devolveu ${stamped.status} ${stamped.text}`);
    const audit = await getJson(`${primary}/audit/events?action=company.time_zone`, otavio);
    assert(audit.status === 200, `auditoria devolveu ${audit.status}`);
    assert(!audit.text.includes('nao-mostrar'), 'auditoria expôs senha');
    assert(!audit.text.includes(oldAuditId ?? 'ausente'), 'auditoria sem período devolveu evento de 48 horas');
    assert(audit.text.includes('company.time_zone'), 'auditoria não registrou o comando de fuso');
    log('auditoria sem período', audit.payload);
  } finally {
    await admin.query(`DELETE FROM messages WHERE conversation_id = ANY($1::uuid[])`, [conversationIds]);
    await admin.query(`DELETE FROM conversation_events WHERE conversation_id = ANY($1::uuid[])`, [conversationIds]);
    await admin.query(`DELETE FROM conversations WHERE id = ANY($1::uuid[])`, [conversationIds]);
    await admin.query(`DELETE FROM visitors WHERE id = ANY($1::uuid[])`, [[visitorId, foreignVisitor]]);
    await admin.query(`DELETE FROM sla_policy_clocks WHERE policy_id = ANY($1::uuid[])`, [[older, newer]]);
    await admin.query(`DELETE FROM sla_policies WHERE id = ANY($1::uuid[])`, [[older, newer]]);
    await admin.end();
  }
}

async function main(): Promise<void> {
  await prepareDatabase();
  let primary = startServer(3000);
  let secondary = startServer(3001);
  await Promise.all([waitHealthy('http://127.0.0.1:3000'), waitHealthy('http://127.0.0.1:3001')]);
  try {
    await regression('http://127.0.0.1:3000');
    await permissionsAndIsolation('http://127.0.0.1:3000');
    await calendar('http://127.0.0.1:3000');
    await idempotency('http://127.0.0.1:3000', async () => {
      await stopServer(primary);
      primary = startServer(3000);
      await waitHealthy('http://127.0.0.1:3000');
      return 'http://127.0.0.1:3000';
    });
    await revokeAcrossReplicas('http://127.0.0.1:3000', 'http://127.0.0.1:3001');
    await qualityAndAudit('http://127.0.0.1:3000');
    log('veredito do script', 'todos os exercícios locais passaram');
  } finally {
    await Promise.all(children.map((child) => stopServer(child)));
    void secondary;
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
  for (const child of children) child.kill('SIGKILL');
});
