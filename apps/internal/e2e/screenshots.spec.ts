import { expect, test, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { pngFile } from './files';
import { chatFileInput, enterAs, isMobileProject, openConversation, USERS } from './project';

const DIR = 'docs/screenshots/etapa-4';
const DIR5 = 'docs/screenshots/etapa-5';

test.describe('artefatos visuais', () => {
  test('Entrar como e chat com seções', async ({ page }, testInfo) => {
    mkdirSync(DIR, { recursive: true });
    const name = testInfo.project.name;

    await page.goto('./?reset=1');
    await expect(page.getByRole('heading', { level: 1, name: 'Entrar como' })).toBeVisible();
    await page.screenshot({ path: `${DIR}/entrar-como-${name}.png` });

    await page.getByRole('button', { name: /Carla Mendes/ }).click();
    await expect(page.getByRole('region', { name: 'Grupos e supervisão' })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Colegas' })).toBeVisible();

    if (isMobileProject(testInfo)) {
      await page.screenshot({ path: `${DIR}/lista-${name}.png` });
      await openConversation(page, /Ana Souza/);
      await page.screenshot({ path: `${DIR}/chat-${name}.png` });
      await page.getByRole('button', { name: /^Voltar/ }).click();
      await page.getByRole('button', { name: 'Nova conversa' }).click();
      await expect(page.getByRole('dialog', { name: 'Nova conversa' })).toBeVisible();
      await page.screenshot({ path: `${DIR}/nova-conversa-${name}.png` });
      await page.keyboard.press('Escape');
      return;
    }

    await openConversation(page, /Ana Souza/);
    await page.screenshot({ path: `${DIR}/chat-${name}.png` });

    await openConversation(page, /Bruno Costa/);
    await chatFileInput(page).setInputFiles(pngFile());
    await expect(page.getByRole('region', { name: 'Pré-visualização do anexo' })).toBeVisible();
    await page.screenshot({ path: `${DIR}/preview-${name}.png` });
    await page.getByRole('button', { name: 'Enviar' }).click();
    await expect(page.getByRole('button', { name: 'Abrir foto em tela cheia' })).toBeVisible();
    await page.screenshot({ path: `${DIR}/midia-${name}.png` });

    await page.getByRole('button', { name: 'Nova conversa' }).click();
    await expect(page.getByRole('dialog', { name: 'Nova conversa' })).toBeVisible();
    await page.screenshot({ path: `${DIR}/nova-conversa-${name}.png` });
    await page.keyboard.press('Escape');
  });

  test('visão do agente e do admin', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== '1366', 'só em 1366');
    mkdirSync(DIR, { recursive: true });
    await enterAs(page, USERS.bruno, { reset: true });
    await expect(page.getByRole('region', { name: 'Grupos e supervisão' })).toBeVisible();
    await page.screenshot({ path: `${DIR}/agente-1366.png` });
    await page.getByRole('button', { name: 'Trocar usuário' }).click();
    await page.getByRole('button', { name: /Marcos Dono/ }).click();
    await expect(page.getByRole('button', { name: 'Administração' })).toBeVisible();
    await page.screenshot({ path: `${DIR}/admin-1366.png` });
  });

  test.describe('Etapa 5: console de administração', () => {
    async function back(page: Page, mobile: boolean) {
      if (mobile) {
        await page.getByRole('button', { name: 'Voltar', exact: true }).click();
        await expect(page.locator('.admin-shell')).toHaveAttribute('data-mobile-pane', 'list');
      }
    }

    test('admin: supervisores, permissões, cadastro, ilhas e registro', async ({ page }, testInfo) => {
      mkdirSync(DIR5, { recursive: true });
      const name = testInfo.project.name;
      const mobile = isMobileProject(testInfo);
      const sections = page.getByRole('group', { name: 'Seções' });
      await enterAs(page, USERS.marcos, { reset: true });
      await page.getByRole('button', { name: 'Administração' }).click();
      await expect(page.getByRole('heading', { level: 1, name: 'Administração' })).toBeVisible();
      await expect(page.getByRole('button', { name: /Rafael Lima/ })).toBeVisible();
      await page.screenshot({ path: `${DIR5}/admin-supervisores-${name}.png` });

      // Detalhe com a chave bloqueada e o motivo visível (a Administração é acima do papel de supervisor).
      await page.getByRole('button', { name: /Rafael Lima/ }).click();
      await expect(page.getByRole('region', { name: /Detalhes de Rafael Lima/ })).toBeVisible();
      const blocked = page.locator('[data-capability-row="admin.console"]');
      await blocked.scrollIntoViewIfNeeded();
      await expect(blocked.locator('.perm-reason')).toBeVisible();
      await expect(blocked.getByRole('switch')).toBeDisabled();
      await page.screenshot({ path: `${DIR5}/admin-detalhe-permissoes-${name}.png` });

      // Uma concessão real, para o registro não sair vazio.
      const publish = page.getByTestId('perm-announcement.publish');
      const before = await publish.getAttribute('aria-checked');
      await publish.click();
      await expect(publish).not.toHaveAttribute('aria-checked', before ?? '');
      await back(page, mobile);

      await page.getByRole('button', { name: 'Novo supervisor' }).click();
      await expect(page.getByRole('heading', { name: 'Cadastrar supervisor' })).toBeVisible();
      await page.getByRole('checkbox', { name: 'Sul' }).check();
      await page.screenshot({ path: `${DIR5}/admin-cadastro-${name}.png` });
      await back(page, mobile);

      await sections.getByRole('button', { name: 'Ilhas', exact: true }).click();
      await expect(page.getByTestId('admin-ilha-ics-norte')).toBeVisible();
      await page.screenshot({ path: `${DIR5}/admin-ilhas-${name}.png` });

      await sections.getByRole('button', { name: 'Registro', exact: true }).click();
      await expect(page.getByRole('list', { name: 'Registro de permissões', exact: true }).getByRole('listitem')).toHaveCount(1);
      await page.screenshot({ path: `${DIR5}/admin-registro-${name}.png` });
    });

    test('supervisor: Equipe, detalhe de agente e chat com Novo grupo', async ({ page }, testInfo) => {
      mkdirSync(DIR5, { recursive: true });
      const name = testInfo.project.name;
      await enterAs(page, USERS.carla, { reset: true });
      await expect(page.getByRole('button', { name: 'Novo grupo' })).toBeVisible();
      await page.screenshot({ path: `${DIR5}/chat-novo-grupo-${name}.png` });

      await page.getByRole('button', { name: 'Equipe' }).click();
      await expect(page.getByRole('heading', { level: 1, name: 'Equipe' })).toBeVisible();
      await expect(page.getByRole('button', { name: /Bruno Costa/ })).toBeVisible();
      await page.screenshot({ path: `${DIR5}/equipe-${name}.png` });

      await page.getByRole('button', { name: /Bruno Costa/ }).click();
      await expect(page.getByRole('region', { name: /Detalhes de Bruno Costa/ })).toBeVisible();
      await expect(page.getByLabel('Mover para a ilha')).toBeVisible();
      await page.screenshot({ path: `${DIR5}/equipe-agente-${name}.png` });
    });

    test('Entrar como com o aviso de conta desativada', async ({ context }, testInfo) => {
      mkdirSync(DIR5, { recursive: true });
      const admin = await context.newPage();
      await enterAs(admin, USERS.marcos, { reset: true });
      const diego = await context.newPage();
      await enterAs(diego, USERS.diego);
      await admin.getByRole('button', { name: 'Administração' }).click();
      await admin.getByRole('group', { name: 'Seções' }).getByRole('button', { name: 'Agentes', exact: true }).click();
      await admin.getByTestId(`admin-user-${USERS.diego}`).click();
      await admin.getByRole('button', { name: 'Desativar' }).click();
      await expect(admin.getByRole('button', { name: 'Reativar' })).toBeVisible();
      await expect(diego.getByRole('alert')).toHaveText('Sua conta foi desativada. Fale com o administrador.');
      await diego.screenshot({ path: `${DIR5}/login-conta-desativada-${testInfo.project.name}.png` });
    });
  });
});
