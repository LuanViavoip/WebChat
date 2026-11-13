import { expect, test } from '@playwright/test';
import { isMobileProject } from './project';

test.describe('lista e conversa no desktop', () => {
  test('abre a conversa de teste com composer', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== '1920', 'cenário pedido em 1920');

    await page.goto('/');
    await expect(page.getByRole('button', { name: /Conversa de teste/ })).toHaveAttribute('aria-current', 'true');
    await expect(page.getByLabel('Mensagem')).toBeEnabled();
    await expect(page.getByRole('log', { name: 'Mensagens' })).toContainText('Nenhuma mensagem ainda');
  });

  test('a busca mantém o item ao vivo quando há erro', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== '1920', 'cenário pedido em 1920');
    await page.goto('/?falha=conectar');
    await expect(page.getByRole('alert')).toBeVisible();
    await expect(page.getByLabel('Mensagem')).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Anexar arquivo' })).toBeDisabled();
    await page.getByRole('searchbox', { name: 'Pesquisar conversa' }).fill('zzzz-inexistente');
    await expect(page.getByRole('button', { name: /Conversa de teste/ })).toBeVisible();
    await expect(page.locator('.live-activity-badge.is-error')).toHaveText('Erro');
    await expect(page.getByText('Nenhum resultado encontrado')).toHaveCount(0);
  });

  test('no carregamento inicial o badge diz Conectando', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== '1920', 'cenário pedido em 1920');
    await page.goto('/?conexao=segurar');
    await expect(page.locator('.live-activity-badge')).toHaveText('Conectando');
    await expect(page.getByText('Reconectando')).toHaveCount(0);
    await expect(page.getByLabel('Mensagem')).toBeDisabled();
    const released = await page.evaluate(() => {
      const hooks = window as Window & { __releaseConnect?: () => void };
      if (typeof hooks.__releaseConnect !== 'function') {
        return false;
      }
      hooks.__releaseConnect();
      return true;
    });
    expect(released).toBe(true);
    await expect(page.getByLabel('Mensagem')).toBeEnabled();
  });

  test('envia mensagem e preserva o histórico ao vivo', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== '1920', 'cenário pedido em 1920');
    await page.goto('/');
    await expect(page.getByLabel('Mensagem')).toBeEnabled();
    await page.getByLabel('Mensagem').fill('oi da conversa de teste');
    await page.getByRole('button', { name: 'Enviar' }).click();
    await expect(page.getByRole('log', { name: 'Mensagens' }).getByText('oi da conversa de teste')).toBeVisible();
    await expect(page.getByLabel('Lida')).toBeVisible();
  });

  test('caudas dos balões usam a cor do grupo e só na primeira mensagem', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== '1920', 'cenário visual em 1920');
    await page.goto('/');
    await expect(page.getByLabel('Mensagem')).toBeEnabled();
    await page.getByLabel('Mensagem').fill('primeira');
    await page.getByRole('button', { name: 'Enviar' }).click();
    await page.getByLabel('Mensagem').fill('segunda');
    await page.getByRole('button', { name: 'Enviar' }).click();
    const first = page.locator('.bubble').filter({ hasText: 'primeira' });
    const second = page.locator('.bubble').filter({ hasText: 'segunda' });
    await expect(first).toHaveClass(/has-tail/);
    await expect(second).not.toHaveClass(/has-tail/);
    const tail = await first.evaluate((node) => {
      const after = getComputedStyle(node, '::after');
      const self = getComputedStyle(node);
      return { content: after.content, background: after.backgroundColor, bubble: self.backgroundColor };
    });
    expect(tail.content).not.toBe('none');
    expect(tail.background).toBe(tail.bubble);
  });
});

test.describe('navegação mobile', () => {
  test('abre na lista, o item leva ao chat e Voltar / histórico do navegador voltam', async ({ page }, testInfo) => {
    test.skip(!isMobileProject(testInfo), 'só em 390×844');

    await page.goto('/');
    await expect(page.getByLabel('Lista de conversas')).toBeVisible();
    await expect(page.getByLabel('Mensagem')).toBeHidden();

    await page.getByRole('button', { name: /Conversa de teste/ }).click();
    await expect(page.getByLabel('Mensagem')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Voltar' })).toBeVisible();

    await page.getByRole('button', { name: 'Voltar' }).click();
    await expect(page.getByLabel('Lista de conversas')).toBeVisible();
    await expect(page.getByLabel('Mensagem')).toBeHidden();

    await page.getByRole('button', { name: /Conversa de teste/ }).click();
    await expect(page.getByLabel('Mensagem')).toBeVisible();
    await page.goBack();
    await expect(page.getByLabel('Lista de conversas')).toBeVisible();
    await expect(page.getByLabel('Mensagem')).toBeHidden();
  });

  test('ao voltar, seleção e foco voltam ao item de origem', async ({ page }, testInfo) => {
    test.skip(!isMobileProject(testInfo), 'só em 390×844');
    await page.goto('/');
    await expect(page.getByLabel('Lista de conversas')).toBeVisible();
    const item = page.getByRole('button', { name: /Conversa de teste/ });
    await item.click();
    await expect(page.getByLabel('Mensagem')).toBeVisible();
    await page.getByRole('button', { name: 'Voltar' }).click();
    await expect(page.getByLabel('Lista de conversas')).toBeVisible();
    await expect(item).toHaveAttribute('aria-current', 'true');
    await expect(item).toBeFocused();

    await item.click();
    await expect(page.getByLabel('Mensagem')).toBeVisible();
    await page.goBack();
    await expect(item).toHaveAttribute('aria-current', 'true');
    await expect(item).toBeFocused();
  });

  test('teclado move o foco ao abrir o chat e o devolve ao voltar', async ({ page }, testInfo) => {
    test.skip(!isMobileProject(testInfo), 'só em 390×844');

    await page.goto('/');
    await expect(page.getByLabel('Lista de conversas')).toBeVisible();

    const liveItem = page.getByRole('button', { name: /Conversa de teste/ });
    await liveItem.focus();
    await expect(liveItem).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.locator('.chat-header')).toBeFocused();

    await page.getByRole('button', { name: 'Voltar' }).click();
    await expect(liveItem).toBeFocused();
  });
});
