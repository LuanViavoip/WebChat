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

  test('administração placeholder sem violações serious/critical', async ({ page }) => {
    await enterAs(page, USERS.marcos, { reset: true });
    await page.getByRole('button', { name: /Administração \(Etapa 5\)/ }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Administração' })).toBeVisible();
    await expectNoSeriousOrCritical(page, 'administração');
  });
});
