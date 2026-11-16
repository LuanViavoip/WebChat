import { expect, test } from '@playwright/test';
import { enterAs, USERS } from './project';

const ICS_NAMES = /Marcos|Carla|Rafael|Ana Souza|Bruno|Camila|Diego|Elisa|Fábio/;
const BV_NAMES = /Helena|Otávio|Paula|Rui/;

test.describe('isolamento entre empresas', () => {
  test('usuário da empresa B não vê ninguém da A na lista nem no seletor Nova conversa', async ({ page }) => {
    await enterAs(page, USERS.paula, { reset: true });
    const sidebar = page.getByLabel('Lista de conversas');
    await expect(sidebar.getByRole('button', { name: /Otávio Reis/ })).toBeVisible();
    await expect(sidebar.locator('.conversation-title').filter({ hasText: ICS_NAMES })).toHaveCount(0);

    await page.getByRole('button', { name: 'Nova conversa' }).click();
    const dialog = page.getByRole('dialog', { name: 'Nova conversa' });
    await expect(dialog.getByRole('button', { name: /Otávio Reis/ })).toBeVisible();
    await expect(dialog.getByRole('button', { name: /Helena Prado/ })).toBeVisible();
    await expect(dialog.getByRole('button', { name: /Rui Cardoso/ })).toBeVisible();
    await expect(dialog.getByRole('button').filter({ hasText: ICS_NAMES })).toHaveCount(0);
    // Fechar + os 3 colegas da B (sem a própria Paula)
    await expect(dialog.getByRole('button')).toHaveCount(4);
  });

  test('o inverso: usuário da A não vê ninguém da B', async ({ page }) => {
    await enterAs(page, USERS.carla, { reset: true });
    await expect(page.getByLabel('Lista de conversas').locator('.conversation-title').filter({ hasText: BV_NAMES })).toHaveCount(0);
    await page.getByRole('button', { name: 'Nova conversa' }).click();
    const dialog = page.getByRole('dialog', { name: 'Nova conversa' });
    await expect(dialog.getByRole('button', { name: /Bruno Costa/ })).toBeVisible();
    await expect(dialog.getByRole('button').filter({ hasText: BV_NAMES })).toHaveCount(0);
  });

  test('duas empresas ao mesmo tempo no mesmo servidor não trocam mensagens', async ({ browser }, testInfo) => {
    test.skip(testInfo.project.name !== '1366', 'cenário de duas abas em 1366');
    const context = await browser.newContext({ viewport: { width: 1366, height: 768 } });
    const a = await context.newPage();
    const b = await context.newPage();
    await enterAs(a, USERS.ana, { reset: true });
    await enterAs(b, USERS.paula);
    await a.getByLabel('Lista de conversas').getByRole('button', { name: /Bruno Costa/ }).click();
    await a.getByLabel('Mensagem').fill('segredo da ICS');
    await a.getByRole('button', { name: 'Enviar' }).click();
    await expect(a.getByRole('log', { name: 'Mensagens' }).getByText('segredo da ICS')).toBeVisible();
    await expect(b.getByText('segredo da ICS')).toHaveCount(0);
    await context.close();
  });
});
