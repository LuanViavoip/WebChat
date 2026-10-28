import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const require = createRequire(process.env.PLAYWRIGHT_PACKAGE_JSON ?? '/tmp/pw/package.json');
const { chromium } = require('playwright');
const serverRequire = createRequire(new URL('../apps/server/package.json', import.meta.url));
const { io } = serverRequire('socket.io-client');

if (process.env.VERIFY_POSTGRES_CONTAINER !== 'webchat-verify-pg' || process.env.VERIFY_INSPECT_ROOMS !== 'true') {
  throw new Error('Use o ambiente descartável webchat-verify-pg e VERIFY_INSPECT_ROOMS=true.');
}
for (const [key, port] of [['DATABASE_URL', '55439'], ['MIGRATE_DATABASE_URL', '55439'], ['REDIS_URL', '56379']]) {
  const url = new URL(process.env[key] ?? '');
  if (url.hostname !== '127.0.0.1' || url.port !== port) throw new Error(`${key} deve apontar ao serviço descartável local na porta ${port}`);
}

const artifacts = process.env.VERIFY_ARTIFACTS ?? '/tmp/webchat-verify-artifacts';
mkdirSync(artifacts, { recursive: true });

const consoleUrl = 'http://127.0.0.1:3000/console/';
const demoUrl = 'http://localhost:8090/';
const password = 'demo-pass-123';
const supportQueue = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaa2';
const tenantA = '11111111-1111-4111-8111-111111111111';
const evidence = [];
let observer;
if (process.env.VERIFY_INSPECT_ROOMS === 'true') {
  const { buildApp } = await import('../apps/server/dist/app.js');
  const { loadConfig } = await import('../apps/server/dist/config.js');
  const { createSMAdapter } = await import('../packages/sm-adapter/dist/index.js');
  const config = loadConfig();
  observer = await buildApp({ ...config, seed: false, serveStatic: false, logger: false }, createSMAdapter('mock'));
  await observer.app.listen({ host: '127.0.0.1', port: 0 });
}

function note(title, value) {
  evidence.push({ title, value });
  console.log(`\n== ${title}`);
  console.log(typeof value === 'string' ? value : JSON.stringify(value, null, 2));
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function login(page, email) {
  await page.goto(consoleUrl);
  await page.getByTestId('login-email').fill(email);
  await page.getByTestId('login-password').fill(password);
  await page.getByTestId('login-submit').click();
  await page.getByRole('navigation', { name: 'Central' }).waitFor();
}

async function sectionLabels(page) {
  return page.getByRole('navigation', { name: 'Central' }).getByRole('button').allTextContents();
}

async function forceStatus(page, path, init) {
  return page.evaluate(async ({ path: requestPath, init: requestInit }) => {
    const token = sessionStorage.getItem('viavoip.agentToken');
    const headers = { authorization: `Bearer ${token}`, ...(requestInit.headers ?? {}) };
    const response = await fetch(requestPath, { ...requestInit, headers });
    return { status: response.status, body: await response.text() };
  }, { path, init });
}

async function connectStaff(page) {
  const token = await page.evaluate(() => sessionStorage.getItem('viavoip.agentToken'));
  assert(token, 'token da sessão não encontrado');
  const socket = io('http://127.0.0.1:3000/supervisor', { auth: { token }, transports: ['websocket'], reconnection: false, forceNew: true });
  await new Promise((resolve, reject) => { socket.once('connect', resolve); socket.once('connect_error', reject); });
  return { socket, token };
}

function socketAck(socket, event, payload) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`timeout ${event}`)), 5000);
    socket.emit(event, payload, (value) => { clearTimeout(timeout); resolve(value); });
  });
}

function sql(statement) {
  return execFileSync('docker', ['exec', process.env.VERIFY_POSTGRES_CONTAINER, 'psql', '-U', 'postgres', '-d', 'webchat', '-tAc', statement]).toString().trim();
}

async function metricValue(page, label) {
  const article = page.locator('[data-testid="supervisor-metrics"] article', { hasText: label }).first();
  await article.waitFor();
  return (await article.locator('strong').innerText()).trim();
}

async function waitMetric(page, label, expected) {
  const started = Date.now();
  let last = '';
  while (Date.now() - started < 15_000) {
    last = await metricValue(page, label);
    if (last === expected) return last;
    await page.waitForTimeout(200);
  }
  throw new Error(`métrica ${label} ficou ${last}, esperado ${expected}`);
}

async function anaAtendimentos(page) {
  const row = page.locator('[role="row"]', { hasText: 'Ana Lima' });
  await row.waitFor();
  const text = await row.innerText();
  const match = text.match(/(\d+) atendimento/);
  return match ? Number(match[1]) : null;
}

async function atendimentoCompleto(browser) {
  sql(`UPDATE conversations
       SET status = 'closed', ended_at = COALESCE(ended_at, now())
       WHERE tenant_id = '11111111-1111-4111-8111-111111111111'
         AND status IN ('queued', 'assigned', 'awaiting_survey')`);
  const stamp = Date.now();
  const visitorBody = `mensagem-visitante-${stamp}`;
  const agentBody = `resposta-agente-${stamp}`;
  const marks = {};
  const shot = async (page, name, target = null) => {
    const at = new Date().toISOString();
    const file = `${artifacts}/${name}.png`;
    if (target) await target.screenshot({ path: file });
    else await page.screenshot({ path: file, fullPage: true });
    marks[name] = at;
  };
  const shotWidget = async (name) => {
    await visitor.waitForFunction(() => {
      const frame = document.querySelector('iframe[title="Webchat ViaVoip"]');
      return frame instanceof HTMLElement && frame.getBoundingClientRect().width >= 300;
    });
    await shot(visitor, name, visitor.locator('iframe[title="Webchat ViaVoip"]'));
  };

  const supervisorContext = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const agentContext = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const visitorContext = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const otherSectorContext = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const otherCompanyContext = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const deskContext = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const otherAgentContext = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const adminContext = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const supervisor = await supervisorContext.newPage();
  const agent = await agentContext.newPage();
  const visitor = await visitorContext.newPage();
  const desk = await deskContext.newPage();
  const otherSector = await otherSectorContext.newPage();
  const otherCompany = await otherCompanyContext.newPage();
  const otherAgent = await otherAgentContext.newPage();
  const admin = await adminContext.newPage();
  await login(supervisor, 'sofia@tenant-a.local');
  await login(agent, 'ana@tenant-a.local');
  await Promise.all([login(desk, 'sofia@tenant-a.local'), login(otherSector, 'helena@tenant-a.local'), login(otherCompany, 'renata@tenant-b.local'), login(otherAgent, 'diana@tenant-a.local'), login(admin, 'otavio@tenant-a.local')]);
  await Promise.all([desk, otherSector, otherCompany, otherAgent].map((page) => page.getByRole('navigation', { name: 'Central' }).getByRole('button', { name: 'Atendimentos' }).click()));
  await Promise.all([otherSector, otherCompany, otherAgent].map((page) => page.getByTestId('connection').filter({ hasText: 'Conectado' }).waitFor()));
  await otherSector.waitForTimeout(200);
  const otherSectorCount = await otherSector.getByTestId('conversation').count();
  const otherCompanyCount = await otherCompany.getByTestId('conversation').count();
  const [ownSocket, sectorSocket, companySocket] = await Promise.all([connectStaff(desk), connectStaff(otherSector), connectStaff(otherCompany)]);
  const ownMessages = [];
  const otherSectorMessages = [];
  const otherCompanyMessages = [];
  ownSocket.socket.on('message.new', (message) => ownMessages.push(message));
  sectorSocket.socket.on('message.new', (message) => otherSectorMessages.push(message));
  companySocket.socket.on('message.new', (message) => otherCompanyMessages.push(message));
  await supervisor.getByTestId('supervisor-metrics').waitFor();
  await agent.getByRole('navigation', { name: 'Central' }).getByRole('button', { name: 'Atendimentos' }).click();
  const presence = agent.getByTestId('presence');
  if (await presence.isEnabled()) await presence.selectOption('available');
  const waitingBefore = Number(await metricValue(supervisor, 'Na fila'));
  const assignedBefore = Number(await metricValue(supervisor, 'Em atendimento'));
  const surveyBefore = Number(await metricValue(supervisor, 'Na pesquisa'));
  const closedBefore = Number(await metricValue(supervisor, 'Concluídos'));
  note('métricas iniciais', { waitingBefore, assignedBefore, surveyBefore, closedBefore, hora: new Date().toISOString() });

  await visitor.goto(demoUrl);
  const frame = visitor.frameLocator('iframe[title="Webchat ViaVoip"]');
  await frame.getByRole('button', { name: 'Suporte' }).click();
  await frame.getByText('Aguardando atendente').waitFor();
  await agent.getByTestId('conversation').filter({ hasText: 'Visitante' }).last().waitFor();
  await waitMetric(supervisor, 'Na fila', String(waitingBefore + 1));
  await shotWidget('01-fila-visitante');
  await shot(agent, '01-fila-agente');
  await shot(supervisor, '01-fila-supervisor');
  note('na fila', { hora: marks['01-fila-supervisor'], naFila: waitingBefore + 1 });

  await frame.getByTestId('composer').fill(visitorBody);
  await frame.getByTestId('send').click();
  await frame.getByTestId('message').filter({ hasText: visitorBody }).waitFor();
  const conversationIdLive = sql(`SELECT conversation_id FROM messages WHERE body = '${visitorBody}'`);
  assert(conversationIdLive, 'conversa não encontrada no banco');
  await visitor.waitForTimeout(300);
  assert(ownMessages.some((message) => message.conversationId === conversationIdLive && message.body === visitorBody), 'supervisora não recebeu evento em tempo real');
  assert(!otherSectorMessages.some((message) => message.conversationId === conversationIdLive), 'outro setor recebeu evento de mensagem');
  assert(!otherCompanyMessages.some((message) => message.conversationId === conversationIdLive), 'outra empresa recebeu evento de mensagem');
  const [ownList, sectorList, companyList, sectorAccess, companyAccess] = await Promise.all([
    socketAck(ownSocket.socket, 'conversation.list', {}), socketAck(sectorSocket.socket, 'conversation.list', {}),
    socketAck(companySocket.socket, 'conversation.list', {}),
    socketAck(sectorSocket.socket, 'history.sync', { conversationId: conversationIdLive }),
    socketAck(companySocket.socket, 'history.sync', { conversationId: conversationIdLive }),
  ]);
  assert(ownList.ok && ownList.conversations.some((item) => item.id === conversationIdLive), 'supervisora não lista conversa');
  assert(sectorList.ok && !sectorList.conversations.some((item) => item.id === conversationIdLive), 'outro setor lista conversa');
  assert(companyList.ok && !companyList.conversations.some((item) => item.id === conversationIdLive), 'outra empresa lista conversa');
  assert(!sectorAccess.ok && sectorAccess.error.code === 'forbidden', 'outro setor leu histórico');
  assert(!companyAccess.ok && companyAccess.error.code === 'forbidden', 'outra empresa leu histórico');
  await desk.getByTestId('conversation').filter({ hasText: 'Aguardando' }).last().click();
  await desk.getByTestId('message').filter({ hasText: visitorBody }).waitFor();
  assert(await desk.getByTestId('composer').count() === 0 && await desk.getByTestId('claim').count() === 0, 'supervisora recebeu controles de resposta ou assumir');
  assert(await otherSector.getByTestId('conversation').count() === otherSectorCount, 'outro setor recebeu conversa na tela');
  assert(await otherCompany.getByTestId('conversation').count() === otherCompanyCount, 'outra empresa recebeu conversa na tela');
  assert(await otherAgent.getByTestId('conversation').count() === 0, 'agente do outro setor vê atendimento');
  note('isolamento de supervisão', { hora: new Date().toISOString(), conversationId: conversationIdLive, outroSetor: sectorAccess.error.code, outraEmpresa: companyAccess.error.code, agenteOutroSetor: 'não lista' });
  await agent.getByTestId('conversation').filter({ hasText: 'Visitante' }).last().click();
  await agent.getByTestId('message').filter({ hasText: visitorBody }).waitFor();
  await shotWidget('02-mensagem-visitante');
  await shot(agent, '02-mensagem-agente');
  note('mensagem do visitante', { hora: new Date().toISOString(), texto: visitorBody });

  await agent.getByTestId('claim').click();
  await agent.getByTestId('notice').filter({ hasText: 'Atendimento assumido' }).waitFor();
  await desk.getByTestId('conversation').filter({ hasText: 'Ana Lima' }).filter({ hasText: 'Em atendimento' }).filter({ hasText: 'Espera' }).waitFor();
  await frame.getByText('Em atendimento').waitFor();
  await waitMetric(supervisor, 'Em atendimento', String(assignedBefore + 1));
  await waitMetric(supervisor, 'Na fila', String(waitingBefore));
  const anaDurante = await anaAtendimentos(supervisor);
  assert(anaDurante === 1, `Ana deveria ter 1 atendimento, tem ${anaDurante}`);
  await shotWidget('03-assumido-visitante');
  await shot(agent, '03-assumido-agente');
  await shot(supervisor, '03-assumido-supervisor');
  note('em atendimento', { hora: marks['03-assumido-supervisor'], anaAtendimentos: anaDurante });

  await agent.getByTestId('composer').fill(agentBody);
  await agent.getByRole('button', { name: 'Enviar' }).click();
  await frame.getByTestId('message').filter({ hasText: agentBody }).waitFor();
  await desk.getByTestId('message').filter({ hasText: agentBody }).waitFor();
  await shotWidget('04-resposta-visitante');
  await shot(agent, '04-resposta-agente');
  note('resposta em tempo real', { hora: new Date().toISOString(), texto: agentBody });

  await agent.getByTestId('close').selectOption({ label: 'Resolvido' });
  await agent.getByRole('button', { name: 'Encerrar' }).click();
  await agent.getByTestId('notice').filter({ hasText: 'Atendimento encerrado' }).waitFor();
  await frame.getByTestId('survey').waitFor();
  await waitMetric(supervisor, 'Na pesquisa', String(surveyBefore + 1));
  await waitMetric(supervisor, 'Em atendimento', String(assignedBefore));
  await shotWidget('05-pesquisa-visitante');
  await shot(agent, '05-pesquisa-agente');
  await shot(supervisor, '05-pesquisa-supervisor');
  note('pesquisa', { hora: marks['05-pesquisa-supervisor'] });

  await frame.getByRole('button', { name: '5', exact: true }).click();
  await frame.getByRole('button', { name: 'Enviar avaliação' }).click();
  await frame.getByTestId('closed').waitFor();
  await desk.locator('[data-testid="conversation"][aria-selected="true"]').filter({ hasText: 'Ana Lima' }).filter({ hasText: 'Encerrada' }).waitFor();
  await waitMetric(supervisor, 'Concluídos', String(closedBefore + 1));
  await waitMetric(supervisor, 'Na pesquisa', String(surveyBefore));
  const anaDepois = await anaAtendimentos(supervisor);
  assert(anaDepois === 0, `Ana deveria voltar a 0 atendimentos, tem ${anaDepois}`);
  await shotWidget('06-encerrado-visitante');
  await shot(agent, '06-encerrado-agente');
  await shot(supervisor, '06-encerrado-supervisor');

  const row = sql(`SELECT c.id::text || '|' || c.status || '|' || COALESCE(ag.name, '') || '|' || c.queued_at::text || '|' || COALESCE(c.assigned_at::text, '') || '|' || COALESCE(c.ended_at::text, '')
    FROM conversations AS c
    LEFT JOIN agents AS ag ON ag.id = c.agent_id
    JOIN messages AS message ON message.conversation_id = c.id
    WHERE message.body = '${visitorBody}'`);
  const [conversationId, status, agentName, queuedAt, assignedAt, endedAt] = row.split('|');
  const messages = sql(`SELECT sender_type || ' ' || created_at::text || ' ' || body FROM messages WHERE conversation_id = '${conversationId}' ORDER BY created_at`);
  const events = sql(`SELECT type || ' ' || created_at::text FROM conversation_events WHERE conversation_id = '${conversationId}' ORDER BY created_at, id`);
  note('postgres', { conversationId, status, agentName, queuedAt, assignedAt, endedAt, messages, events, horaEncerrado: marks['06-encerrado-supervisor'] });
  assert(status === 'closed', `status ${status}`);
  assert(agentName === 'Ana Lima', `agente ${agentName}`);
  assert(messages.includes(visitorBody) && messages.includes(agentBody), 'mensagens ausentes');
  for (const type of ['queued', 'assigned', 'classified', 'survey_submitted']) {
    assert(events.includes(type), `evento ${type} ausente`);
  }
  sql(`UPDATE conversations SET ended_at = now() - interval '23 hours' WHERE id = '${conversationId}'`);
  const recent = await socketAck(ownSocket.socket, 'conversation.list', {});
  assert(recent.ok && recent.conversations.some((item) => item.id === conversationId), 'encerrada há 23h desapareceu');
  sql(`UPDATE conversations SET ended_at = now() - interval '25 hours' WHERE id = '${conversationId}'`);
  const expired = await socketAck(ownSocket.socket, 'conversation.list', {});
  assert(expired.ok && !expired.conversations.some((item) => item.id === conversationId), 'encerrada antiga permaneceu na lista');
  sql(`UPDATE conversations SET ended_at = now() WHERE id = '${conversationId}'`);
  note('janela das encerradas', { conversationId, recente: 'visível no navegador', antiga23h: 'listada', antiga25h: 'fora da lista' });

  const roomName = `tenant:${tenantA}:supervisors:queue:${supportQueue}`;
  assert(observer, 'VERIFY_INSPECT_ROOMS=true é necessário para confirmar a saída da room');
  const roomBefore = await observer.io.of('/supervisor').in(roomName).fetchSockets();
  assert(roomBefore.some((socket) => socket.id === ownSocket.socket.id), 'supervisora não entrou na room');
  let receivedAfterSuspension = false;
  ownSocket.socket.on('message.new', () => { receivedAfterSuspension = true; });
  const disconnected = new Promise((resolve) => ownSocket.socket.once('disconnect', resolve));
  const suspended = await forceStatus(admin, '/company/commands', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ requestId: crypto.randomUUID(), command: { kind: 'agent.suspend', agentId: 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaa6', reason: 'verificação local' } }),
  });
  assert(suspended.status === 200, `suspensão retornou ${suspended.status}`);
  await disconnected;
  const roomAfter = await observer.io.of('/supervisor').in(roomName).fetchSockets();
  assert(!roomAfter.some((socket) => socket.id === ownSocket.socket.id), 'supervisora suspensa continua na room');
  const laterContext = await browser.newContext();
  const laterVisitor = await laterContext.newPage();
  await laterVisitor.goto(demoUrl);
  const laterFrame = laterVisitor.frameLocator('iframe[title="Webchat ViaVoip"]');
  await laterFrame.getByRole('button', { name: 'Suporte' }).click();
  await laterFrame.getByText('Aguardando atendente').waitFor();
  const laterBody = `mensagem-apos-suspensao-${stamp}`;
  await laterFrame.getByTestId('composer').fill(laterBody);
  await laterFrame.getByTestId('send').click();
  await laterFrame.getByTestId('message').filter({ hasText: laterBody }).waitFor();
  await agent.getByTestId('conversation').filter({ hasText: 'Visitante' }).last().click();
  await agent.getByTestId('message').filter({ hasText: laterBody }).waitFor();
  await laterContext.close();
  const retry = io('http://127.0.0.1:3000/supervisor', { auth: { token: ownSocket.token }, transports: ['websocket'], reconnection: false, forceNew: true });
  const retryError = await new Promise((resolve, reject) => { retry.once('connect_error', resolve); retry.once('connect', () => reject(new Error('token revogado aceito'))); });
  retry.disconnect();
  assert(sectorSocket.socket.connected && companySocket.socket.connected, 'outros supervisores desconectados');
  assert(!receivedAfterSuspension, 'supervisora suspensa recebeu mensagem');
  note('suspensão', { hora: new Date().toISOString(), http: suspended.status, roomAntes: true, roomDepois: false, reconexão: retryError.message, outrosConectados: true, mensagemPosteriorRecebidaPelaAgente: laterBody });
  sectorSocket.socket.disconnect();
  companySocket.socket.disconnect();
  await deskContext.close();
  await otherSectorContext.close();
  await otherCompanyContext.close();
  await otherAgentContext.close();
  await adminContext.close();
  await supervisorContext.close();
  await agentContext.close();
  await visitorContext.close();
}

const browser = await chromium.launch({ headless: true });
try {
  const demo = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await demo.goto(demoUrl);
  await demo.locator('iframe[title="Webchat ViaVoip"]').waitFor();
  const frame = demo.frameLocator('iframe[title="Webchat ViaVoip"]');
  await frame.getByRole('heading', { name: 'Site A' }).waitFor();
  await frame.getByRole('button', { name: 'Suporte' }).waitFor();
  await demo.screenshot({ path: `${artifacts}/demo-widget.png`, fullPage: true });
  note('demo', { url: demoUrl, widget: true });
  await demo.close();

  const expected = {
    'ana@tenant-a.local': {
      file: 'console-agente.png',
      present: ['Atendimentos', 'Chat interno', 'Setores', 'Anúncios', 'Minha atividade'],
      absent: ['Administração', 'Qualidade', 'Visão geral'],
    },
    'sofia@tenant-a.local': {
      file: 'console-supervisora.png',
      present: ['Visão geral', 'Qualidade', 'Setores', 'Atendimentos'],
      absent: ['Administração'],
    },
    'otavio@tenant-a.local': {
      file: 'console-admin.png',
      present: ['Visão geral', 'Administração', 'Qualidade', 'Atendimentos'],
      absent: [],
    },
  };

  for (const [email, spec] of Object.entries(expected)) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await context.newPage();
    await login(page, email);
    const labels = await sectionLabels(page);
    note(`seções ${email}`, labels);
    for (const label of spec.present) assert(labels.some((item) => item.includes(label)), `${email} não mostra ${label}`);
    for (const label of spec.absent) assert(!labels.some((item) => item.includes(label)), `${email} mostra ${label}`);
    await page.screenshot({ path: `${artifacts}/${spec.file}`, fullPage: true });
    await context.close();
  }

  const agent = await browser.newContext();
  const agentPage = await agent.newPage();
  await login(agentPage, 'ana@tenant-a.local');
  const agentCommand = await forceStatus(agentPage, '/company/commands', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      requestId: crypto.randomUUID(),
      command: { kind: 'company.rename', name: 'Forçada pelo agente' },
    }),
  });
  const agentAudit = await forceStatus(agentPage, '/audit/events', { method: 'GET' });
  note('agente forçado', { comando: agentCommand.status, auditoria: agentAudit.status });
  assert(agentCommand.status === 403 && agentAudit.status === 403, 'agente passou do backend');
  await agent.close();

  const supervisor = await browser.newContext();
  const supervisorPage = await supervisor.newPage();
  await login(supervisorPage, 'sofia@tenant-a.local');
  const supervisorCommand = await forceStatus(supervisorPage, '/company/commands', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      requestId: crypto.randomUUID(),
      command: { kind: 'company.rename', name: 'Forçada pela supervisora' },
    }),
  });
  const from = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const to = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  const tenantReport = await forceStatus(
    supervisorPage,
    `/quality/report?scopeKind=tenant&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
    { method: 'GET' },
  );
  const ownReport = await forceStatus(
    supervisorPage,
    `/quality/report?scopeKind=queue&queueId=${supportQueue}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
    { method: 'GET' },
  );
  note('supervisora forçada', { comando: supervisorCommand.status, tenant: tenantReport.status, filaPropria: ownReport.status });
  assert(supervisorCommand.status === 403 && tenantReport.status === 403 && ownReport.status === 200, 'escopo da supervisora');
  await supervisor.close();

  const admin = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const adminPage = await admin.newPage();
  await login(adminPage, 'otavio@tenant-a.local');
  const queueName = `FilaBrowser${Date.now()}`;
  const bodies = [];
  await adminPage.route('**/company/commands', async (route) => {
    if (route.request().method() !== 'POST') {
      await route.continue();
      return;
    }
    bodies.push(route.request().postDataJSON());
    if (bodies.length === 1) {
      await new Promise((resolve) => setTimeout(resolve, 3_500));
      await route.abort('timedout');
      return;
    }
    await route.continue();
  });
  await adminPage.getByRole('button', { name: 'Administração' }).click();
  await adminPage.getByTestId('queue-name').fill(queueName);
  await adminPage.getByTestId('queue-create').click();
  await adminPage.getByTestId('command-result').filter({ hasText: queueName }).waitFor({ timeout: 15_000 });
  const resultText = await adminPage.getByTestId('command-result').innerText();
  await adminPage.screenshot({ path: `${artifacts}/console-admin-fila.png`, fullPage: true });
  const requestIds = bodies.map((body) => body.requestId);
  note('retry do console', { requisicoes: bodies.length, requestIds, resultado: resultText });
  assert(bodies.length === 2, `esperava 2 requisições, vi ${bodies.length}`);
  assert(requestIds[0] === requestIds[1], 'o retry trocou o requestId');
  assert(resultText.includes('Efeito único'), resultText);
  const count = sql(`SELECT (SELECT count(*) FROM queues WHERE name = '${queueName}')::text || ',' || (SELECT count(*) FROM audit_events WHERE action = 'queue.create' AND resource_id = (SELECT id FROM queues WHERE name = '${queueName}'))::text`);
  note('efeito único no banco', count);
  assert(count === '1,1', `efeito duplicado: ${count}`);
  const desk = await forceStatus(adminPage, '/company/desk', { method: 'GET' });
  assert(desk.status === 200 && !desk.body.includes('Forçada pelo agente') && !desk.body.includes('Forçada pela supervisora'), 'renomeação forçada persistiu');
  await admin.close();
  note('veredito do navegador', 'seções, bloqueio e retry conferidos');
  await atendimentoCompleto(browser);
} catch (error) {
  console.error('Falha da verificação:', error);
  process.exitCode = 1;
} finally {
  await browser.close();
  await new Promise((resolve) => setTimeout(resolve, 500));
  await observer?.app.close();
  writeFileSync(`${artifacts}/browser-evidence.json`, JSON.stringify(evidence, null, 2));
}
