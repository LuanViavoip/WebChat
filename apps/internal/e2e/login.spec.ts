import { expect, test } from '@playwright/test';
import { enterAs, USERS } from './project';

test.describe('Entrar como', () => {
  test('lista os usuários ativos agrupados por empresa, com nome e role em português', async ({ page }) => {
    await page.goto('./?reset=1');
    await expect(page.getByRole('heading', { level: 1, name: 'Entrar como' })).toBeVisible();
    await expect(page.getByRole('heading', { level: 2 })).toHaveText(['ICS Saúde', 'Clínica Boa Vista']);

    const ics = page.getByRole('region', { name: 'ICS Saúde' });
    await expect(ics.getByRole('button')).toHaveCount(9);
    await expect(ics.getByRole('button', { name: 'Marcos Dono Administrador' })).toBeVisible();
    await expect(ics.getByRole('button', { name: 'Carla Mendes Supervisor(a)' })).toBeVisible();
    await expect(ics.getByRole('button', { name: 'Bruno Costa Agente' })).toBeVisible();

    const bv = page.getByRole('region', { name: 'Clínica Boa Vista' });
    await expect(bv.getByRole('button')).toHaveCount(4);
    await expect(bv.getByRole('button', { name: /Paula Teixeira/ })).toBeVisible();
    await expect(page.getByLabel('Lista de conversas')).toHaveCount(0);
  });

  test('clicar entra no chat do usuário; o reload mantém a sessão da aba', async ({ page }, testInfo) => {
    await page.goto('./?reset=1');
    await page.getByRole('button', { name: /Bruno Costa/ }).click();
    const sidebar = page.getByLabel('Lista de conversas');
    await expect(sidebar).toBeVisible();
    await expect(sidebar.getByText('Agente · ICS Saúde')).toBeVisible();
    await expect(page.getByRole('heading', { level: 1, name: 'Entrar como' })).toHaveCount(0);

    await page.reload();
    await expect(sidebar).toBeVisible();
    await expect(sidebar.getByText('Agente · ICS Saúde')).toBeVisible();
    await expect(page.getByRole('heading', { level: 1, name: 'Entrar como' })).toHaveCount(0);
    expect(testInfo.project.name).toBeTruthy();
  });

  test('Trocar usuário limpa a sessão e volta ao Entrar como; entrar de novo vale só para a aba', async ({
    page,
  }) => {
    await enterAs(page, USERS.bruno, { reset: true });
    await page.getByRole('button', { name: 'Trocar usuário' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Entrar como' })).toBeVisible();
    expect(new URL(page.url()).searchParams.has('como')).toBe(false);

    await page.reload();
    await expect(page.getByRole('heading', { level: 1, name: 'Entrar como' })).toBeVisible();

    await page.getByRole('button', { name: /Paula Teixeira/ }).click();
    await expect(page.getByLabel('Lista de conversas').getByText('Agente · Clínica Boa Vista')).toBeVisible();
    await expect(page.getByLabel('Lista de conversas').getByRole('button', { name: /Bruno Costa/ })).toHaveCount(0);
  });

  test('?como= inválido mostra Entrar como', async ({ page }) => {
    await page.goto('./?como=ninguem');
    await expect(page.getByRole('heading', { level: 1, name: 'Entrar como' })).toBeVisible();
    await expect(page.getByLabel('Lista de conversas')).toHaveCount(0);
  });

  test('?como= entra direto, e o tenant vem do usuário', async ({ page }) => {
    await enterAs(page, USERS.paula, { reset: true });
    const sidebar = page.getByLabel('Lista de conversas');
    await expect(sidebar.getByText('Agente · Clínica Boa Vista')).toBeVisible();
    await expect(sidebar.getByRole('button', { name: /Otávio Reis/ })).toBeVisible();
  });

  test('o admin usa o chat, vê o link de Administração e o console volta ao chat', async ({ page }) => {
    await enterAs(page, USERS.marcos, { reset: true });
    await page.getByRole('button', { name: 'Administração' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Administração' })).toBeVisible();
    await page.getByRole('button', { name: 'Voltar ao chat' }).click();
    await expect(page.getByLabel('Lista de conversas')).toBeVisible();
  });

  for (const userId of [USERS.carla, USERS.bruno, USERS.otavio]) {
    test(`${userId} não vê o link de Administração`, async ({ page }) => {
      await enterAs(page, userId, { reset: true });
      await expect(page.getByRole('button', { name: 'Trocar usuário' })).toBeVisible();
      await expect(page.getByRole('button', { name: /Administração/ })).toHaveCount(0);
    });
  }
});
