import { expect, test } from '@playwright/test';
import { isMobileProject, isWidgetProject } from './project';

test.describe('histórico no desktop', () => {
  test('abre as três conversas em sequência', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== '1920', 'cenário pedido em 1920');

    await page.goto('/?nome=Maria%20Silva');
    await expect(page.getByText(/Como posso ajudar/)).toBeVisible();

    await page.getByRole('button', { name: /Atendimento anterior/ }).click();
    await expect(page.getByText('Atendimento encerrado · somente leitura')).toBeVisible();
    await expect(page.getByText(/remarcar a consulta da clínica da família/)).toBeVisible();
    await expect(page.getByLabel('Mensagem')).toHaveCount(0);

    await page.getByRole('button', { name: /Exames e vacinas/ }).click();
    await expect(page.getByText(/campanha de influenza/)).toBeVisible();
    await expect(page.getByText('Atendimento encerrado · somente leitura')).toBeVisible();

    await page.getByRole('button', { name: /ICS Pré-atendimento/ }).click();
    await expect(page.getByRole('log', { name: 'Mensagens' }).getByText(/Como posso ajudar/)).toBeVisible();
    await expect(page.getByLabel('Mensagem')).toBeVisible();
  });
});

test.describe('navegação mobile', () => {
  test('abre na lista, o item leva ao chat e Voltar / histórico do navegador voltam', async ({ page }, testInfo) => {
    test.skip(!isMobileProject(testInfo), 'só em 390×844');

    await page.goto('/?nome=Maria%20Silva');
    await expect(page.getByLabel('Lista de conversas')).toBeVisible();
    await expect(page.getByLabel('Mensagem')).toBeHidden();

    await page.getByRole('button', { name: /ICS Pré-atendimento/ }).click();
    await expect(page.getByLabel('Mensagem')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Voltar' })).toBeVisible();

    await page.getByRole('button', { name: 'Voltar' }).click();
    await expect(page.getByLabel('Lista de conversas')).toBeVisible();
    await expect(page.getByLabel('Mensagem')).toBeHidden();

    await page.getByRole('button', { name: /Atendimento anterior/ }).click();
    await expect(page.getByText('Atendimento encerrado · somente leitura')).toBeVisible();

    await page.goBack();
    await expect(page.getByLabel('Lista de conversas')).toBeVisible();
    await expect(page.getByLabel('Mensagem')).toBeHidden();
  });
});

test.describe('widget sem lista', () => {
  test('abre direto no chat ao vivo', async ({ page }, testInfo) => {
    test.skip(!isWidgetProject(testInfo), 'só no projeto widget');
    await page.goto('/?modo=widget');
    await page.getByRole('button', { name: /Abrir chat de atendimento/ }).click();
    await expect(page.getByLabel('Lista de conversas')).toHaveCount(0);
    await expect(page.getByLabel('Mensagem')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Voltar' })).toHaveCount(0);
  });
});
