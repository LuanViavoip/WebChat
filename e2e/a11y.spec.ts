import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { audioFile, pdfFile, pngFile, videoFile } from './files';
import { chatFileInput, enterAs, isMobileProject, openConversation, USERS } from './project';

async function expectNoSeriousOrCritical(page: Page, label: string) {
  const results = await new AxeBuilder({ page }).analyze();
  const blocking = results.violations.filter(
    (violation) => violation.impact === 'serious' || violation.impact === 'critical',
  );
  expect(blocking, `${label}: ${JSON.stringify(blocking, null, 2)}`).toEqual([]);
}

async function attachAndSend(page: Page, file: { name: string; mimeType: string; buffer: Buffer }) {
  await chatFileInput(page).setInputFiles(file);
  await expect(page.getByRole('region', { name: 'Pré-visualização do anexo' })).toBeVisible();
  await page.getByRole('button', { name: 'Enviar' }).click();
}

async function expectMediaA11y(page: Page, label: string) {
  await chatFileInput(page).setInputFiles(pngFile());
  await expect(page.getByRole('region', { name: 'Pré-visualização do anexo' })).toBeVisible();
  await expectNoSeriousOrCritical(page, `${label} preview`);
  await page.getByRole('button', { name: 'Enviar' }).click();
  await attachAndSend(page, pdfFile());
  await attachAndSend(page, audioFile());
  await attachAndSend(page, videoFile());
  await expect(page.getByRole('button', { name: 'Abrir foto em tela cheia' })).toBeVisible();
  await expectNoSeriousOrCritical(page, `${label} bolhas de mídia`);
  await page.getByRole('button', { name: 'Abrir foto em tela cheia' }).click();
  await expect(page.getByRole('dialog', { name: 'Foto em tela cheia' })).toBeVisible();
  await expectNoSeriousOrCritical(page, `${label} viewer`);
  await page.keyboard.press('Escape');
}

test.describe('axe nos 4 viewports', () => {
  test('Entrar como sem violações serious/critical', async ({ page }) => {
    await page.goto('/?reset=1');
    await expect(page.getByRole('heading', { level: 1, name: 'Entrar como' })).toBeVisible();
    await expectNoSeriousOrCritical(page, 'Entrar como');
  });

  test('lista com seções, chat, seletor Nova conversa e estado vazio sem violações serious/critical', async ({ page }, testInfo) => {
    await enterAs(page, USERS.carla, { reset: true });
    const sidebar = page.getByLabel('Lista de conversas');
    await expect(sidebar.getByRole('region', { name: 'Grupos e supervisão' })).toBeVisible();
    await expect(sidebar.getByRole('region', { name: 'Colegas' })).toBeVisible();

    if (isMobileProject(testInfo)) {
      await expect(page.getByLabel('Mensagem')).toBeHidden();
      await expectNoSeriousOrCritical(page, 'lista com seções');

      await page.getByRole('button', { name: 'Nova conversa' }).click();
      await expect(page.getByRole('dialog', { name: 'Nova conversa' })).toBeVisible();
      await expectNoSeriousOrCritical(page, 'seletor Nova conversa');
      await page.keyboard.press('Escape');
      await expect(page.getByRole('dialog', { name: 'Nova conversa' })).toBeHidden();

      await openConversation(page, /Bruno Costa/);
      await expectNoSeriousOrCritical(page, 'chat');
      await expectMediaA11y(page, 'mobile');
      return;
    }

    await expect(page.getByLabel('Mensagem')).toBeEnabled();
    await expectNoSeriousOrCritical(page, 'lista com seções + chat');
    await page.getByRole('button', { name: 'Nova conversa' }).click();
    await expect(page.getByRole('dialog', { name: 'Nova conversa' })).toBeVisible();
    await expectNoSeriousOrCritical(page, 'seletor Nova conversa');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: 'Nova conversa' })).toBeHidden();
    await expectMediaA11y(page, 'página');
  });

  test('Entrar como com o aviso de conta desativada sem violações serious/critical', async ({ context }) => {
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
    await expectNoSeriousOrCritical(diego, 'Entrar como com aviso de conta desativada');
  });

  test('administração (console) sem violações serious/critical', async ({ page }) => {
    await enterAs(page, USERS.marcos, { reset: true });
    await page.getByRole('button', { name: 'Administração' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Administração' })).toBeVisible();
    await expectNoSeriousOrCritical(page, 'administração');
  });

  test.describe('console de administração e Equipe', () => {
    async function backToList(page: Page, mobile: boolean) {
      if (mobile) {
        await page.getByRole('button', { name: 'Voltar', exact: true }).click();
      }
    }

    async function visibleH1Count(page: Page) {
      return page.locator('h1:visible').count();
    }

    test('admin: detalhe só leitura, editável, ilha, formulário, registro e diálogo sem serious/critical', async ({ page }, testInfo) => {
      const mobile = isMobileProject(testInfo);
      await enterAs(page, USERS.marcos, { reset: true });
      await expectNoSeriousOrCritical(page, 'admin chat com Novo grupo');
      await page.getByRole('button', { name: 'Novo grupo' }).click();
      await expect(page.getByRole('dialog', { name: 'Novo grupo' })).toBeVisible();
      await expectNoSeriousOrCritical(page, 'admin diálogo Novo grupo');
      await page.keyboard.press('Escape');

      await page.getByRole('button', { name: 'Administração' }).click();
      await expect(page.getByRole('heading', { level: 1, name: 'Administração' })).toBeVisible();
      await expectNoSeriousOrCritical(page, 'admin lista');

      await page.getByRole('button', { name: /Marcos Dono/ }).click();
      await expect(page.getByRole('region', { name: /Detalhes de Marcos Dono/ })).toBeVisible();
      await expectNoSeriousOrCritical(page, 'admin detalhe só leitura (Você)');
      expect(await visibleH1Count(page)).toBe(1);
      await backToList(page, mobile);

      await page.getByRole('button', { name: /Rafael Lima/ }).click();
      await expect(page.getByRole('region', { name: /Detalhes de Rafael Lima/ })).toBeVisible();
      await expectNoSeriousOrCritical(page, 'admin detalhe editável');
      expect(await visibleH1Count(page)).toBe(1);
      await backToList(page, mobile);

      await page.getByRole('button', { name: 'Novo supervisor' }).click();
      await expect(page.getByLabel('Nome')).toBeVisible();
      await expectNoSeriousOrCritical(page, 'admin formulário de cadastro');
      await backToList(page, mobile);

      await page.getByRole('button', { name: 'Ilhas' }).click();
      await page.getByRole('button', { name: /Norte/ }).first().click();
      await expect(page.getByRole('region', { name: /Detalhes da ilha Norte/ })).toBeVisible();
      await expectNoSeriousOrCritical(page, 'admin detalhe de ilha');
      expect(await visibleH1Count(page)).toBe(1);
      await backToList(page, mobile);

      await page.getByRole('button', { name: 'Registro' }).click();
      await expect(page.getByRole('region', { name: /Registro de permissões, rolável/ })).toBeVisible();
      await expectNoSeriousOrCritical(page, 'admin registro');
    });

    test('supervisor: Equipe (Você, agente, formulário, registro) e diálogo Novo grupo sem serious/critical', async ({ page }, testInfo) => {
      const mobile = isMobileProject(testInfo);
      await enterAs(page, USERS.carla, { reset: true });
      await page.getByRole('button', { name: 'Novo grupo' }).click();
      await expect(page.getByRole('dialog', { name: 'Novo grupo' })).toBeVisible();
      await expectNoSeriousOrCritical(page, 'supervisor diálogo Novo grupo');
      await page.keyboard.press('Escape');

      await page.getByRole('button', { name: 'Equipe' }).click();
      await expect(page.getByRole('heading', { level: 1, name: 'Equipe' })).toBeVisible();
      await expectNoSeriousOrCritical(page, 'equipe lista');

      await page.getByRole('button', { name: /Carla Mendes/ }).click();
      await expect(page.getByRole('region', { name: /Detalhes de Carla Mendes/ })).toBeVisible();
      await expectNoSeriousOrCritical(page, 'equipe detalhe só leitura (Você)');
      expect(await visibleH1Count(page)).toBe(1);
      await backToList(page, mobile);

      await page.getByRole('button', { name: /Bruno Costa/ }).click();
      await expect(page.getByRole('region', { name: /Detalhes de Bruno Costa/ })).toBeVisible();
      await expectNoSeriousOrCritical(page, 'equipe detalhe editável');
      await backToList(page, mobile);

      await page.getByRole('button', { name: 'Novo agente' }).click();
      await expect(page.getByLabel('Nome')).toBeVisible();
      await expectNoSeriousOrCritical(page, 'equipe formulário de cadastro');
      await backToList(page, mobile);

      await page.getByRole('button', { name: 'Registro' }).click();
      await expectNoSeriousOrCritical(page, 'equipe registro');
    });
  });
});
