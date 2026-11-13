import { expect, test } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { isMobileProject, isPageProject } from './project';

const DIR = process.env['CI'] ? 'docs/screenshots/etapa-3' : 'test-results/screenshots/etapa-3';

test.describe('artefatos visuais', () => {
  test('depois — página', async ({ page }, testInfo) => {
    test.skip(!isPageProject(testInfo));
    mkdirSync(DIR, { recursive: true });
    await page.goto('/');

    if (isMobileProject(testInfo)) {
      await expect(page.getByLabel('Lista de conversas')).toBeVisible();
      await page.screenshot({ path: `${DIR}/depois-390-lista.png` });
      await page.getByRole('button', { name: /Conversa de teste/ }).click();
      await expect(page.getByLabel('Mensagem')).toBeEnabled();
      await page.locator('.wa-chat input[type="file"]').setInputFiles({
        name: 'foto.png',
        mimeType: 'image/png',
        buffer: Buffer.from(
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
          'base64',
        ),
      });
      await expect(page.getByRole('region', { name: 'Pré-visualização do anexo' })).toBeVisible();
      await page.screenshot({ path: `${DIR}/preview-390.png` });
      await page.getByRole('button', { name: 'Enviar' }).click();
      await expect(page.getByRole('button', { name: 'Abrir foto em tela cheia' })).toBeVisible();
      await page.screenshot({ path: `${DIR}/depois-390-chat.png` });
      await page.getByRole('button', { name: 'Abrir foto em tela cheia' }).click();
      await page.screenshot({ path: `${DIR}/viewer-390.png` });
      await page.keyboard.press('Escape');
      return;
    }

    await expect(page.getByLabel('Mensagem')).toBeEnabled();
    await page.locator('.wa-chat input[type="file"]').setInputFiles({
      name: 'foto.png',
      mimeType: 'image/png',
      buffer: Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
        'base64',
      ),
    });
    await expect(page.getByRole('region', { name: 'Pré-visualização do anexo' })).toBeVisible();
    await page.screenshot({ path: `${DIR}/preview-${testInfo.project.name}.png` });
    await page.getByRole('button', { name: 'Enviar' }).click();
    await expect(page.getByRole('button', { name: 'Abrir foto em tela cheia' })).toBeVisible();
    await page.screenshot({ path: `${DIR}/depois-${testInfo.project.name}.png` });
    if (testInfo.project.name === '1920' || testInfo.project.name === '1366') {
      await page.getByRole('button', { name: 'Abrir foto em tela cheia' }).click();
      await expect(page.getByRole('dialog', { name: 'Foto em tela cheia' })).toBeVisible();
      await page.screenshot({ path: `${DIR}/viewer-${testInfo.project.name}.png` });
      await page.keyboard.press('Escape');
    }
  });
});
