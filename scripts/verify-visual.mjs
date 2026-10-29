// Verificação visual do console e do widget (Playwright), no mesmo estilo de verify-browser.mjs.
// Uso (ambiente descartável da skill verify, com o servidor, o nginx da demo na 8090 e, opcionalmente, o site na 3100):
//   PLAYWRIGHT_PACKAGE_JSON=/tmp/webchat-verify-pw/package.json VERIFY_POSTGRES_CONTAINER=webchat-verify-pg \
//   node scripts/verify-visual.mjs
// Variáveis opcionais: VERIFY_VISUAL_OUT (padrão artifacts/visual/depois), VERIFY_VISUAL_HOSTS (ex.: "8090,3100").
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';

const require = createRequire(process.env.PLAYWRIGHT_PACKAGE_JSON ?? '/tmp/pw/package.json');
const { chromium } = require('playwright');

if (process.env.VERIFY_POSTGRES_CONTAINER !== 'webchat-verify-pg') {
  throw new Error('Use o ambiente descartável webchat-verify-pg (VERIFY_POSTGRES_CONTAINER).');
}

const out = process.env.VERIFY_VISUAL_OUT ?? new URL('../artifacts/visual/depois', import.meta.url).pathname;
mkdirSync(out, { recursive: true });

const consoleUrl = 'http://127.0.0.1:3000/console/';
const password = 'demo-pass-123';
const hostPorts = (process.env.VERIFY_VISUAL_HOSTS ?? '8090,3100').split(',').map((item) => item.trim());
const viewports = [
  ['1920x1080', 1920, 1080],
  ['1366x768', 1366, 768],
  ['768x1024', 768, 1024],
  ['390x844', 390, 844],
  ['375x667', 375, 667],
];

const failures = [];
const consoleErrors = [];
let checks = 0;

function check(condition, message) {
  checks += 1;
  if (!condition) {
    failures.push(message);
    console.error(`FALHA: ${message}`);
  }
}

function sql(statement) {
  return execFileSync('docker', ['exec', process.env.VERIFY_POSTGRES_CONTAINER, 'psql', '-U', 'postgres', '-d', 'webchat', '-tAc', statement]).toString().trim();
}

function watch(page, label) {
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(`${label}: ${message.text()}`);
  });
  page.on('pageerror', (error) => consoleErrors.push(`${label}: ${error.message}`));
}

async function noHorizontalOverflow(page, label) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check(overflow <= 0, `${label}: rolagem horizontal de ${overflow}px`);
}

function insideViewport(box, viewport, label) {
  const ok = box && box.x >= -0.5 && box.y >= -0.5 && box.x + box.width <= viewport.width + 0.5 && box.y + box.height <= viewport.height + 0.5;
  check(Boolean(ok), `${label}: fora do viewport ${JSON.stringify(box)} em ${viewport.width}x${viewport.height}`);
}

async function login(browser, email, size) {
  const context = await browser.newContext({ viewport: { width: size[1], height: size[2] } });
  const page = await context.newPage();
  watch(page, `${email} ${size[0]}`);
  await page.goto(consoleUrl);
  await page.getByTestId('login-email').fill(email);
  await page.getByTestId('login-password').fill(password);
  await page.getByTestId('login-submit').click();
  await page.getByTestId('connection').waitFor();
  await page.waitForTimeout(500);
  return page;
}

async function go(page, slug) {
  await page.evaluate((value) => { window.location.hash = `#/${value}`; }, slug);
  await page.waitForTimeout(900);
}

async function hasVisibleFocus(page) {
  return page.evaluate(() => {
    const element = document.activeElement;
    if (!element || element === document.body) return false;
    const style = getComputedStyle(element);
    return style.outlineStyle !== 'none' && Number.parseFloat(style.outlineWidth) >= 2;
  });
}

async function tabUntil(page, predicate, label) {
  for (let step = 0; step < 40; step += 1) {
    await page.keyboard.press('Tab');
    if (await page.evaluate(predicate)) {
      check(await hasVisibleFocus(page), `${label}: foco sem anel visível`);
      return;
    }
  }
  check(false, `${label}: o Tab não chegou ao alvo`);
}

async function openMenuIfNeeded(page) {
  const toggle = page.getByRole('button', { name: 'Abrir menu' });
  if (await toggle.isVisible()) {
    await toggle.click();
    await page.waitForTimeout(300);
  }
}

// Fluxo completo: visitante abre o widget no site, entra na fila, o agente assume, conversam, encerra e o visitante avalia.
async function widgetCycle(browser, agent, size, port) {
  const [name, width, height] = size;
  const viewport = { width, height };
  const label = `${port} ${name}`;
  const demoPrefix = port === '3100' && name === '1366x768' ? 'demo-3100' : null;
  const shot = async (page, file, demoName) => {
    await page.screenshot({ path: `${out}/visual-${port}-${name}-${file}.png` });
    if (demoPrefix && demoName) await page.screenshot({ path: `${out}/${demoPrefix}-${demoName}.png` });
  };
  sql(`UPDATE conversations SET status = 'closed', ended_at = COALESCE(ended_at, now()) WHERE tenant_id = '11111111-1111-4111-8111-111111111111' AND status IN ('queued', 'assigned', 'awaiting_survey')`);

  const context = await browser.newContext({ viewport });
  const visitor = await context.newPage();
  watch(visitor, `visitante ${label}`);
  const stamp = `${port}-${name}-${Date.now()}`;
  const visitorBody = `Olá, preciso de ajuda (${stamp}).\nSegunda linha da mensagem.`;
  const agentBody = `Claro, já estou verificando (${stamp}).`;
  try {
    await visitor.goto(`http://localhost:${port}/`);
    const iframe = visitor.locator('iframe[title="Webchat ViaVoip"]');
    await iframe.waitFor();
    const frame = visitor.frameLocator('iframe[title="Webchat ViaVoip"]');
    await frame.getByTestId('launcher').waitFor();
    await visitor.waitForTimeout(600);

    // Botão fechado: 88x88, dentro do viewport e acima do banner de cookies do site (quando houver).
    const closedBox = await iframe.boundingBox();
    check(Math.round(closedBox?.width ?? 0) === 88 && Math.round(closedBox?.height ?? 0) === 88, `${label}: botão deveria ter 88x88, tem ${JSON.stringify(closedBox)}`);
    insideViewport(closedBox, viewport, `${label} botão`);
    const banner = await visitor.evaluate(() => Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--cookie-banner-height')) || 0);
    if (banner > 0) check((closedBox?.y ?? 0) + (closedBox?.height ?? 0) <= viewport.height - banner + 0.5, `${label}: botão sobre o banner de cookies (${banner}px)`);
    await noHorizontalOverflow(visitor, `${label} site`);
    await shot(visitor, 'widget-fechado', '01-site-botao');

    await frame.getByTestId('launcher').click();
    await frame.getByRole('button', { name: 'Suporte' }).waitFor();
    await visitor.waitForTimeout(400);
    const openBox = await iframe.boundingBox();
    insideViewport(openBox, viewport, `${label} painel aberto`);
    if (width <= 640) check(Math.round(openBox?.width ?? 0) === width && Math.round(openBox?.height ?? 0) === height, `${label}: painel deveria ocupar a tela, tem ${JSON.stringify(openBox)}`);
    else check(Math.round(openBox?.width ?? 0) <= 400 && Math.round(openBox?.height ?? 0) <= 640, `${label}: painel maior que 400x640 ${JSON.stringify(openBox)}`);
    await shot(visitor, 'widget-aberto', '02-painel-departamentos');

    await frame.getByRole('button', { name: 'Suporte' }).click();
    await frame.getByText('Aguardando atendente').waitFor();
    await shot(visitor, 'widget-fila', '03-na-fila');

    // O agente assume pelo console.
    await go(agent, 'atendimentos');
    const item = agent.getByTestId('conversation').filter({ hasText: 'Aguardando' }).last();
    await item.waitFor();
    await item.click();
    const presence = agent.getByTestId('presence');
    if (await presence.isEnabled()) await presence.selectOption('available');
    await agent.getByTestId('claim').click();
    await agent.getByTestId('composer').waitFor();
    await frame.getByText('Em atendimento').waitFor();

    // Visitante escreve; o agente responde.
    await frame.getByTestId('composer').fill(visitorBody);
    await frame.getByTestId('send').click();
    await frame.getByTestId('message').filter({ hasText: `(${stamp})` }).waitFor();
    await agent.getByTestId('message').filter({ hasText: `(${stamp})` }).waitFor();
    await agent.getByTestId('composer').fill(agentBody);
    await agent.getByRole('button', { name: 'Enviar' }).click();
    await frame.getByTestId('message').filter({ hasText: agentBody }).waitFor();
    await visitor.waitForTimeout(300);
    insideViewport(await frame.getByTestId('composer').boundingBox(), viewport, `${label} compositor do widget`);
    insideViewport(await iframe.boundingBox(), viewport, `${label} painel em atendimento`);
    await shot(visitor, 'widget-atendimento', '05-troca-visitante');
    insideViewport(await agent.getByTestId('composer').boundingBox(), { width, height }, `${label} compositor do agente`);
    await noHorizontalOverflow(agent, `${label} central do agente`);
    await shot(agent, 'agente-atendimento', '04-agente-assume');

    // O agente encerra com classificação (a confirmação é um modal).
    const details = agent.getByRole('button', { name: 'Ver detalhes' });
    if (await details.isVisible()) {
      await details.click();
      await agent.waitForTimeout(300);
    }
    await agent.getByTestId('close').selectOption({ label: 'Resolvido' });
    await agent.getByRole('button', { name: 'Encerrar' }).click();
    await agent.getByRole('dialog').last().getByRole('button', { name: 'Encerrar atendimento' }).click();
    await frame.getByTestId('survey').waitFor();
    await visitor.waitForTimeout(300);
    insideViewport(await iframe.boundingBox(), viewport, `${label} pesquisa`);
    await shot(visitor, 'widget-pesquisa', '06-pesquisa');

    await frame.getByRole('button', { name: '5', exact: true }).click();
    await frame.getByRole('button', { name: 'Enviar avaliação' }).click();
    await frame.getByTestId('closed').waitFor();
    await shot(visitor, 'widget-encerrado', '07-encerrado');
    await agent.keyboard.press('Escape');
  } finally {
    await context.close();
  }
}

// Origem não autorizada: o widget não posta nada para o site e o iframe fica do tamanho do botão (causa raiz do recorte).
async function unauthorizedOrigin(browser, size) {
  const [name, width, height] = size;
  const viewport = { width, height };
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  watch(page, `origem não autorizada ${name}`);
  // Servidor local numa porta sorteada: uma origem real (loopback) que não está na lista de origens do site.
  const host = createServer((_request, response) => {
    response.setHeader('content-type', 'text/html');
    response.end('<!doctype html><html><body><h1>Site sem autorização</h1><script async src="http://localhost:3000/widget.js" data-widget-id="site_a"></script></body></html>');
  });
  await new Promise((resolve) => host.listen(0, '127.0.0.1', resolve));
  const hostPort = host.address().port;
  try {
    await page.goto(`http://127.0.0.1:${hostPort}/`);
    const iframe = page.locator('iframe[title="Webchat ViaVoip"]');
    await iframe.waitFor();
    const frame = page.frameLocator('iframe[title="Webchat ViaVoip"]');
    const launcher = frame.getByTestId('launcher');
    await launcher.waitFor();
    await page.waitForTimeout(1200);
    check(await launcher.isDisabled(), `${name}: botão deveria ficar inerte em origem não autorizada`);
    await launcher.click({ force: true, timeout: 1000 }).catch(() => undefined);
    await page.waitForTimeout(300);
    const box = await iframe.boundingBox();
    check(Math.round(box?.width ?? 0) === 88 && Math.round(box?.height ?? 0) === 88, `${name}: iframe deveria continuar com 88x88, tem ${JSON.stringify(box)}`);
    insideViewport(box, viewport, `${name} botão em origem não autorizada`);
    await page.screenshot({ path: `${out}/visual-nao-autorizado-${name}.png` });
  } finally {
    await context.close();
    await new Promise((resolve) => host.close(resolve));
  }
}

const browser = await chromium.launch();
try {
  for (const size of viewports) {
    const [name, width, height] = size;
    console.log(`\n== ${name}`);
    const agent = await login(browser, 'ana@tenant-a.local', size);
    await go(agent, 'atendimentos');
    await noHorizontalOverflow(agent, `${name} agente`);
    await agent.screenshot({ path: `${out}/visual-console-${name}-agente.png` });

    // Foco visível no menu lateral (no celular o menu é uma gaveta).
    await openMenuIfNeeded(agent);
    await agent.getByRole('navigation', { name: 'Central', exact: true }).getByRole('button').first().focus();
    await agent.keyboard.press('Tab');
    check(await agent.evaluate(() => Boolean(document.activeElement?.closest('nav[aria-label="Central"]'))), `${name}: Tab saiu do menu lateral`);
    check(await hasVisibleFocus(agent), `${name}: foco sem anel visível no menu lateral`);
    await agent.screenshot({ path: `${out}/visual-console-${name}-foco-menu.png` });
    await agent.keyboard.press('Escape');

    for (const port of hostPorts) await widgetCycle(browser, agent, size, port);

    await unauthorizedOrigin(browser, size);

    await go(agent, 'chat-interno');
    await noHorizontalOverflow(agent, `${name} chat interno`);
    await agent.screenshot({ path: `${out}/visual-console-${name}-chat-interno.png` });
    await agent.context().close();

    const supervisor = await login(browser, 'sofia@tenant-a.local', size);
    await go(supervisor, 'visao-geral');
    await supervisor.getByTestId('supervisor-metrics').waitFor();
    await noHorizontalOverflow(supervisor, `${name} supervisor`);
    await supervisor.screenshot({ path: `${out}/visual-console-${name}-supervisor.png` });
    await go(supervisor, 'qualidade');
    await supervisor.waitForTimeout(1000);
    await noHorizontalOverflow(supervisor, `${name} qualidade`);
    await supervisor.screenshot({ path: `${out}/visual-console-${name}-qualidade.png` });
    await supervisor.context().close();

    const admin = await login(browser, 'otavio@tenant-a.local', size);
    await go(admin, 'administracao');
    await admin.getByRole('tab', { name: 'Empresa' }).waitFor();
    await noHorizontalOverflow(admin, `${name} administração`);
    await admin.screenshot({ path: `${out}/visual-console-${name}-admin.png` });
    await admin.getByRole('tab', { name: 'Filas' }).click();
    await admin.getByRole('button', { name: 'Nova fila' }).click();
    await admin.getByRole('dialog').waitFor();
    await tabUntil(admin, () => Boolean(document.activeElement?.closest('dialog')), `${name} modal`);
    await admin.screenshot({ path: `${out}/visual-console-${name}-modal.png` });
    await admin.keyboard.press('Escape');
    await admin.context().close();
  }
} finally {
  await browser.close();
}

console.log(`\n${checks} verificações; ${failures.length} falhas; ${consoleErrors.length} erros de console.`);
for (const error of consoleErrors) console.error(`ERRO DE CONSOLE: ${error}`);
if (failures.length > 0 || consoleErrors.length > 0) process.exitCode = 1;
