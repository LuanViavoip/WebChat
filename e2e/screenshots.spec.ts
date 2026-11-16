import { expect, test } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { pngFile } from './files';
import { chatFileInput, enterAs, isMobileProject, openConversation, USERS } from './project';

const DIR = 'docs/screenshots/etapa-4';

test.describe('artefatos visuais', () => {
  test('Entrar como e chat com seções', async ({ page }, testInfo) => {
    mkdirSync(DIR, { recursive: true });
    const name = testInfo.project.name;

    await page.goto('/?reset=1');
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
});
