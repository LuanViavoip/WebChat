import { expect, test } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { isMobileProject, isPageProject, isWidgetProject } from './project';

const DIR = process.env['CI'] ? 'docs/screenshots/etapa-1.3' : 'test-results/screenshots/etapa-1.3';

test.describe('artefatos visuais', () => {
  test('depois — página', async ({ page }, testInfo) => {
    test.skip(!isPageProject(testInfo));
    mkdirSync(DIR, { recursive: true });
    await page.goto('/?nome=Maria%20Silva');

    if (isMobileProject(testInfo)) {
      await expect(page.getByLabel('Lista de conversas')).toBeVisible();
      await page.screenshot({ path: `${DIR}/depois-390-lista.png` });
      await page.getByRole('button', { name: /ICS Pré-atendimento/ }).click();
      await expect(page.getByText(/Como posso ajudar/)).toBeVisible();
      await page.screenshot({ path: `${DIR}/depois-390-chat.png` });
      return;
    }

    await expect(page.getByText(/Como posso ajudar/)).toBeVisible();
    await page.screenshot({ path: `${DIR}/depois-${testInfo.project.name}.png` });

    if (testInfo.project.name === '1920') {
      await page.getByRole('button', { name: /Atendimento anterior/ }).click();
      await expect(page.getByText('Atendimento encerrado · somente leitura')).toBeVisible();
      await page.screenshot({ path: `${DIR}/depois-historico.png` });
    }
  });

  test('depois — widget', async ({ page }, testInfo) => {
    test.skip(!isWidgetProject(testInfo));
    mkdirSync(DIR, { recursive: true });
    await page.goto('/?modo=widget');
    await page.getByRole('button', { name: /Abrir chat de atendimento/ }).click();
    await expect(page.getByText(/Como posso ajudar/)).toBeVisible();
    await page.screenshot({ path: `${DIR}/depois-widget.png` });
  });
});
