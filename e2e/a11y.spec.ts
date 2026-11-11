import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { isMobileProject, isPageProject, isWidgetProject } from './project';

async function expectNoSeriousOrCritical(page: Page, label: string) {
  const results = await new AxeBuilder({ page }).analyze();
  const blocking = results.violations.filter(
    (violation) => violation.impact === 'serious' || violation.impact === 'critical',
  );
  expect(blocking, `${label}: ${JSON.stringify(blocking, null, 2)}`).toEqual([]);
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

      await page.getByRole('button', { name: 'Voltar' }).click();
      await page.getByRole('button', { name: /Atendimento anterior/ }).click();
      await expect(page.getByText('Atendimento encerrado · somente leitura')).toBeVisible();
      await expectNoSeriousOrCritical(page, 'histórico');
      return;
    }

    await expect(page.getByText(/Como posso ajudar/)).toBeVisible();
    await expectNoSeriousOrCritical(page, 'lista + chat ao vivo');

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
  });
});
