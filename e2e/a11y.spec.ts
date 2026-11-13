import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { audioFile, pdfFile, pngFile, videoFile } from './files';
import { chatFileInput, isMobileProject, isPageProject, isWidgetProject } from './project';

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
  test('lista, chat ao vivo e histórico sem violações serious/critical', async ({ page }, testInfo) => {
    test.skip(!isPageProject(testInfo), 'só no modo página');

    await page.goto('/?nome=Maria%20Silva');
    await expect(page.getByLabel('Lista de conversas')).toBeVisible();

    if (isMobileProject(testInfo)) {
      await expect(page.getByLabel('Mensagem')).toBeHidden();
      await expectNoSeriousOrCritical(page, 'lista');

      await page.getByRole('button', { name: /ICS Pré-atendimento/ }).click();
      await expect(page.getByText(/Como posso ajudar/)).toBeVisible();
      await expectNoSeriousOrCritical(page, 'chat ao vivo');
      await expectMediaA11y(page, 'mobile');

      await page.getByRole('button', { name: 'Voltar' }).click();
      await page.getByRole('button', { name: /Atendimento anterior/ }).click();
      await expect(page.getByText('Atendimento encerrado · somente leitura')).toBeVisible();
      await expectNoSeriousOrCritical(page, 'histórico');
      return;
    }

    await expect(page.getByText(/Como posso ajudar/)).toBeVisible();
    await expectNoSeriousOrCritical(page, 'lista + chat ao vivo');
    await expectMediaA11y(page, 'página');

    await page.getByRole('button', { name: /Atendimento anterior/ }).click();
    await expect(page.getByText('Atendimento encerrado · somente leitura')).toBeVisible();
    await expectNoSeriousOrCritical(page, 'histórico');
  });
});

test.describe('axe widget', () => {
  test('chat ao vivo do widget sem violações serious/critical', async ({ page }, testInfo) => {
    test.skip(!isWidgetProject(testInfo), 'só no projeto widget');
    await page.goto('/?modo=widget');
    await page.getByRole('button', { name: /Abrir chat de atendimento/ }).click();
    await expect(page.getByText(/Como posso ajudar/)).toBeVisible();
    await expectNoSeriousOrCritical(page, 'widget');
    await expectMediaA11y(page, 'widget');
  });
});
