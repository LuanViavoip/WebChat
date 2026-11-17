import AxeBuilder from '@axe-core/playwright';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { enterAs, isMobileProject, USERS } from './project';

/**
 * Console de administração (Etapa 5) com duas ou mais abas no MESMO servidor simulado (um context só:
 * localStorage e BroadcastChannel compartilhados). Roda em 1366 (duas colunas) e 390 (lista/detalhe).
 *
 * A negação NO SERVIDOR (supervisor forjando grant/mover agente de outra ilha) não é exercitada aqui: o transporte
 * não é alcançável pela página sem um gancho de produção, e este e2e não cria backdoor. Ela é coberta pelos testes
 * vitest do MockServer (MockServer.admin.test.ts, adminTransport.test.ts). Aqui provamos o que o usuário vê.
 */

const PAULA = 'Paula Siqueira';
const NOVO_AGENTE = 'Agente Novo';
const DEACTIVATED_TEXT = 'Sua conta foi desativada. Fale com o administrador.';
const GROUP_MANAGE = 'perm-group.manage';

async function expectNoSeriousOrCritical(page: Page, label: string) {
  const results = await new AxeBuilder({ page }).analyze();
  const blocking = results.violations.filter(
    (violation) => violation.impact === 'serious' || violation.impact === 'critical',
  );
  expect(blocking, `${label}: ${JSON.stringify(blocking, null, 2)}`).toEqual([]);
}

/** Marca a página: se ela recarregar, a marca some. `reloads()` conta cargas completas depois da marca. */
async function markPage(page: Page) {
  let loads = 0;
  page.on('load', () => {
    loads += 1;
  });
  await page.evaluate(() => {
    Object.assign(window, { __semReload: true });
  });
  return {
    async expectNoReload() {
      const alive = await page.evaluate(() => Reflect.get(window, '__semReload') === true);
      expect(alive, 'a página recarregou (a marca em window sumiu)').toBe(true);
      expect(loads, 'a página fez uma carga completa').toBe(0);
    },
  };
}

function groupSwitch(page: Page) {
  return page.getByTestId(GROUP_MANAGE);
}

function sections(page: Page) {
  return page.getByRole('group', { name: 'Seções' });
}

/** No mobile o detalhe cobre a lista: volta para ela. No desktop não faz nada. */
async function showList(page: Page, mobile: boolean) {
  if (mobile) {
    await page.getByRole('button', { name: 'Voltar', exact: true }).click();
    await expect(page.locator('.admin-shell')).toHaveAttribute('data-mobile-pane', 'list');
  }
}

async function openConsole(page: Page, entry: 'Administração' | 'Equipe', section?: string) {
  await page.getByRole('button', { name: entry }).click();
  await expect(page.getByRole('heading', { level: 1, name: entry })).toBeVisible();
  if (section) {
    await sections(page).getByRole('button', { name: section, exact: true }).click();
  }
}

/** Admin: cadastra a supervisora na ilha Sul; sai com o detalhe dela aberto (group.manage nasce ligado). */
async function registerPaula(admin: Page) {
  await openConsole(admin, 'Administração', 'Supervisores');
  await admin.getByRole('button', { name: 'Novo supervisor' }).click();
  await admin.getByLabel('Nome').fill(PAULA);
  await admin.getByRole('checkbox', { name: 'Sul' }).check();
  await admin.getByRole('button', { name: 'Cadastrar supervisor' }).click();
  await expect(admin.getByRole('status').filter({ hasText: `Supervisor ${PAULA} cadastrado.` })).toBeVisible();
  await expect(admin.getByRole('heading', { name: PAULA })).toBeVisible();
  await expect(groupSwitch(admin)).toHaveAttribute('aria-checked', 'true');
}

async function setGroupManage(admin: Page, on: boolean) {
  const toggle = groupSwitch(admin);
  await expect(toggle).toBeEnabled();
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-checked', String(on));
}

/** Uma segunda página, no mesmo contexto, entra como Paula pelo "Entrar como" (o cadastro já está no servidor). */
async function enterAsPaula(context: BrowserContext): Promise<Page> {
  const page = await context.newPage();
  await page.goto('./');
  await page.getByRole('button', { name: new RegExp(PAULA) }).click();
  await expect(page.getByLabel('Lista de conversas')).toBeVisible();
  return page;
}

function newGroupButton(page: Page) {
  return page.getByRole('button', { name: 'Novo grupo' });
}

test.describe('console de administração com duas páginas', () => {
  test.beforeEach(({ page: _page }, testInfo) => {
    test.skip(!['1366', '390'].includes(testInfo.project.name), 'só em 1366 e 390');
  });

  test('o admin cadastra a Paula; a chave group.manage liga e desliga o "Novo grupo" dela sem reload; ela não vê Administração', async ({
    context,
  }, testInfo) => {
    const mobile = isMobileProject(testInfo);
    const admin = await context.newPage();
    await enterAs(admin, USERS.marcos, { reset: true });
    await registerPaula(admin);
    await expectNoSeriousOrCritical(admin, 'admin detalhe da supervisora recém-cadastrada');

    const paula = await enterAsPaula(context);
    await expect(newGroupButton(paula)).toBeVisible();
    await expectNoSeriousOrCritical(paula, 'Paula chat com Novo grupo');
    const mark = await markPage(paula);

    // Desliga: o botão some em Paula, sem reload (o evento `grants` chega pelo servidor).
    await setGroupManage(admin, false);
    await expect(newGroupButton(paula)).toHaveCount(0);
    await mark.expectNoReload();

    // Religa: volta, ainda sem reload.
    await setGroupManage(admin, true);
    await expect(newGroupButton(paula)).toBeVisible();
    await mark.expectNoReload();

    // c) Paula é supervisora: não vê Administração, vê Equipe.
    await expect(paula.getByRole('button', { name: /Administração/ })).toHaveCount(0);
    await expect(paula.getByRole('button', { name: 'Equipe' })).toBeVisible();
    await openConsole(paula, 'Equipe');
    await expect(paula.getByRole('heading', { level: 1, name: 'Equipe' })).toBeVisible();
    await expectNoSeriousOrCritical(paula, 'Paula Equipe');
    await mark.expectNoReload();

    if (mobile) {
      await showList(admin, true);
    }
    await expect(admin.locator('.admin-list')).toContainText(PAULA);
  });

  test('o registro do admin mostra a revogação e a concessão feitas', async ({ context }, testInfo) => {
    const mobile = isMobileProject(testInfo);
    const admin = await context.newPage();
    await enterAs(admin, USERS.marcos, { reset: true });
    await registerPaula(admin);
    await setGroupManage(admin, false);
    await setGroupManage(admin, true);

    // O registro da própria pessoa, no detalhe, já lista as duas (a mais nova primeiro).
    const personal = admin.getByRole('list', { name: `Registro de permissões de ${PAULA}`, exact: true });
    await expect(personal.getByRole('listitem')).toHaveCount(2);

    await showList(admin, mobile);
    await sections(admin).getByRole('button', { name: 'Registro', exact: true }).click();
    const log = admin.getByRole('list', { name: 'Registro de permissões', exact: true });
    const items = log.getByRole('listitem');
    await expect(items).toHaveCount(2);
    await expect(items.nth(0)).toContainText(`Marcos Dono concedeu Criar e editar grupos a ${PAULA}`);
    await expect(items.nth(1)).toContainText(`Marcos Dono revogou Criar e editar grupos de ${PAULA}`);
    await expectNoSeriousOrCritical(admin, 'admin registro com entradas');
  });

  test('a Paula cadastra um agente na Ilha Sul (visível ao admin sem reload) e só alcança os agentes de ilhas dela', async ({
    context,
  }, testInfo) => {
    const mobile = isMobileProject(testInfo);
    const admin = await context.newPage();
    await enterAs(admin, USERS.marcos, { reset: true });
    await registerPaula(admin);
    await showList(admin, mobile);
    await sections(admin).getByRole('button', { name: 'Agentes', exact: true }).click();
    const adminMark = await markPage(admin);

    const paula = await enterAsPaula(context);
    const paulaMark = await markPage(paula);
    await openConsole(paula, 'Equipe');
    const list = paula.locator('.admin-list');

    // Escopo N:N: os agentes de ALGUMA ilha dela (Sul): Camila, Diego e a Ana, que está em Norte e Sul.
    // Ninguém só da Norte (Bruno) nem só de Exames/Plantão (Elisa, Fábio).
    await expect(list.getByRole('button', { name: /Camila Ribeiro/ })).toBeVisible();
    await expect(list.getByRole('button', { name: /Diego Martins/ })).toBeVisible();
    await expect(list.getByRole('button', { name: /Ana Souza/ })).toContainText('Ilhas Norte, Sul');
    for (const outsider of [/Bruno Costa/, /Elisa Barbosa/, /Fábio Nunes/]) {
      await expect(list.getByRole('button', { name: outsider })).toHaveCount(0);
    }

    await list.getByRole('button', { name: 'Novo agente' }).click();
    const ilhaSelect = paula.getByLabel('Ilha', { exact: true });
    await expect(ilhaSelect.locator('option')).toHaveText(['Sul']);
    await paula.getByLabel('Nome').fill(NOVO_AGENTE);
    await paula.getByRole('button', { name: 'Cadastrar agente' }).click();
    await expect(paula.getByRole('status').filter({ hasText: `Agente ${NOVO_AGENTE} cadastrado na ilha Sul.` })).toBeVisible();

    if (mobile) {
      await showList(paula, true);
    }
    await expect(list.getByRole('button', { name: new RegExp(NOVO_AGENTE) })).toBeVisible();
    // O admin vê o agente novo na lista dele sem recarregar.
    await expect(admin.locator('.admin-list').getByRole('button', { name: new RegExp(NOVO_AGENTE) })).toBeAttached();
    await adminMark.expectNoReload();

    // Vínculo: a Paula só supervisiona a Sul e a Camila já está nela, então não há ilha para acrescentar.
    await list.getByRole('button', { name: /Camila Ribeiro/ }).click();
    await expect(paula.getByRole('region', { name: /Detalhes de Camila Ribeiro/ })).toBeVisible();
    await expect(paula.getByText('Não há outra ilha disponível para adicionar a este agente.')).toBeVisible();
    await expect(paula.getByLabel('Adicionar à ilha')).toHaveCount(0);
    await expect(paula.locator('.admin-detail')).not.toContainText('Norte');
    await paulaMark.expectNoReload();
  });

  test('conta desativada: a sessão aberta cai com aviso, some do Entrar como, a URL direta avisa e reativar devolve o acesso', async ({
    context,
  }, testInfo) => {
    const mobile = isMobileProject(testInfo);
    const admin = await context.newPage();
    await enterAs(admin, USERS.marcos, { reset: true });
    const diego = await context.newPage();
    await enterAs(diego, USERS.diego);
    const mark = await markPage(diego);

    await openConsole(admin, 'Administração', 'Agentes');
    await admin.getByTestId(`admin-user-${USERS.diego}`).click();
    await expect(admin.getByRole('region', { name: /Detalhes de Diego Martins/ })).toBeVisible();
    await admin.getByRole('button', { name: 'Desativar' }).click();
    await expect(admin.getByRole('button', { name: 'Reativar' })).toBeVisible();

    // A sessão do Diego cai sem reload, com a mensagem, e ele some do "Entrar como".
    await expect(diego.getByRole('heading', { level: 1, name: 'Entrar como' })).toBeVisible();
    await expect(diego.getByRole('alert')).toHaveText(DEACTIVATED_TEXT);
    await mark.expectNoReload();
    await expect(diego.getByRole('button', { name: /Diego Martins/ })).toHaveCount(0);
    await expectNoSeriousOrCritical(diego, 'Entrar como com aviso de conta desativada');

    // URL direta com a conta desativada: mesma mensagem.
    const direct = await context.newPage();
    await direct.goto(`./?como=${USERS.diego}`);
    await expect(direct.getByRole('heading', { level: 1, name: 'Entrar como' })).toBeVisible();
    await expect(direct.getByRole('alert')).toHaveText(DEACTIVATED_TEXT);
    await expect(direct.getByLabel('Lista de conversas')).toHaveCount(0);

    // Reativa: ele volta à lista do "Entrar como" (sem reload) e entra.
    await admin.getByRole('button', { name: 'Reativar' }).click();
    await expect(admin.getByRole('button', { name: 'Desativar' })).toBeVisible();
    const back = diego.getByRole('button', { name: /Diego Martins/ });
    await expect(back).toBeVisible();
    await back.click();
    await expect(diego.getByLabel('Lista de conversas')).toBeVisible();
    await expect(diego.getByRole('alert')).toHaveCount(0);

    const again = await context.newPage();
    await enterAs(again, USERS.diego);

    if (mobile) {
      await showList(admin, true);
    }
  });

  test('isolamento: a outra empresa não vê a Paula nem o agente novo, e o console dela não mostra nada da primeira', async ({
    context,
  }, testInfo) => {
    const mobile = isMobileProject(testInfo);
    const admin = await context.newPage();
    await enterAs(admin, USERS.marcos, { reset: true });
    const helena = await context.newPage();
    await enterAs(helena, USERS.helena);
    const rui = await context.newPage();
    await enterAs(rui, USERS.rui);
    await openConsole(helena, 'Administração', 'Supervisores');
    const helenaList = helena.locator('.admin-list');
    await expect(helenaList.getByRole('button', { name: /Otávio Reis/ })).toBeVisible();

    // A ICS cadastra a Paula, mexe na permissão dela e cadastra um agente.
    await registerPaula(admin);
    await setGroupManage(admin, false);
    await setGroupManage(admin, true);
    await showList(admin, mobile);
    await sections(admin).getByRole('button', { name: 'Agentes', exact: true }).click();
    await admin.getByRole('button', { name: 'Novo agente' }).click();
    await admin.getByLabel('Nome').fill(NOVO_AGENTE);
    await admin.getByRole('button', { name: 'Cadastrar agente' }).click();
    await expect(admin.getByRole('status').filter({ hasText: `Agente ${NOVO_AGENTE} cadastrado` })).toBeVisible();

    // Ao vivo e depois de recarregar (o estado em disco é o que manda): nada da ICS do outro lado.
    async function expectBvClean() {
      await expect(helenaList).not.toContainText(PAULA);
      await expect(helenaList).not.toContainText(NOVO_AGENTE);
      await expect(helenaList).not.toContainText('Marcos Dono');
      await sections(helena).getByRole('button', { name: 'Agentes', exact: true }).click();
      await expect(helenaList).not.toContainText(NOVO_AGENTE);
      await expect(helenaList.getByRole('button', { name: /Rui Cardoso/ })).toBeVisible();
      await sections(helena).getByRole('button', { name: 'Registro', exact: true }).click();
      await expect(helena.getByRole('list', { name: 'Registro de permissões', exact: true })).toHaveCount(0);
      await expect(helena.getByText('Nenhuma permissão concedida ou revogada ainda.')).toBeVisible();
      await expect(helenaList).not.toContainText(PAULA);

      const sidebar = rui.getByLabel('Lista de conversas');
      await expect(sidebar.getByRole('button', { name: /Paula Teixeira/ })).toBeVisible();
      await expect(sidebar.getByRole('button', { name: new RegExp(`${PAULA}|${NOVO_AGENTE}|Carla|Diego`) })).toHaveCount(0);
      await rui.getByRole('button', { name: 'Nova conversa' }).click();
      const dialog = rui.getByRole('dialog', { name: 'Nova conversa' });
      await expect(dialog.getByRole('button', { name: /Otávio Reis/ })).toBeVisible();
      await expect(dialog.getByRole('button', { name: new RegExp(`${PAULA}|${NOVO_AGENTE}`) })).toHaveCount(0);
      await rui.keyboard.press('Escape');
      await expect(dialog).toBeHidden();
    }
    await expectBvClean();
    await expectNoSeriousOrCritical(helena, 'Helena registro vazio (outra empresa)');

    await helena.reload();
    await expect(helena.getByLabel('Lista de conversas')).toBeVisible();
    await openConsole(helena, 'Administração', 'Supervisores');
    await expect(helenaList.getByRole('button', { name: /Otávio Reis/ })).toBeVisible();
    await expect(helenaList).not.toContainText(PAULA);
    await sections(helena).getByRole('button', { name: 'Registro', exact: true }).click();
    await expect(helena.getByText('Nenhuma permissão concedida ou revogada ainda.')).toBeVisible();
  });
});
