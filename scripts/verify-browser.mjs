import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const require = createRequire('/tmp/pw/package.json');
const { chromium } = require('playwright');

const artifacts = '/opt/cursor/artifacts/screenshots';
mkdirSync(artifacts, { recursive: true });

const consoleUrl = 'http://127.0.0.1:3000/console/';
const demoUrl = 'http://localhost:8090/';
const password = 'demo-pass-123';
const supportQueue = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaa2';
const evidence = [];

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
  const count = execFileSync('psql', [
    '-h', '127.0.0.1', '-U', 'postgres', '-d', 'webchat', '-tAc',
    `SELECT (SELECT count(*) FROM queues WHERE name = '${queueName}')::text || ',' || (SELECT count(*) FROM audit_events WHERE action = 'queue.create' AND resource_id = (SELECT id FROM queues WHERE name = '${queueName}'))::text`,
  ], { env: { ...process.env, PGPASSWORD: 'postgres' } }).toString().trim();
  note('efeito único no banco', count);
  assert(count === '1,1', `efeito duplicado: ${count}`);
  const desk = await forceStatus(adminPage, '/company/desk', { method: 'GET' });
  assert(desk.status === 200 && !desk.body.includes('Forçada pelo agente') && !desk.body.includes('Forçada pela supervisora'), 'renomeação forçada persistiu');
  await admin.close();
  note('veredito do navegador', 'seções, bloqueio e retry conferidos');
} finally {
  await browser.close();
  writeFileSync('/opt/cursor/artifacts/browser-evidence.json', JSON.stringify(evidence, null, 2));
}
