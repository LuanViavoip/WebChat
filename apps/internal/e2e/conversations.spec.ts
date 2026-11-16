import { expect, test } from '@playwright/test';
import { enterAs, isMobileProject, openConversation, USERS } from './project';

test.describe('lista e conversa no desktop', () => {
  test('abre a primeira conversa selecionada, com composer e o outro lado no cabeçalho', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== '1920', 'cenário pedido em 1920');

    await enterAs(page, USERS.carla, { reset: true });
    await expect(page.getByRole('button', { name: /Ana Souza/ })).toHaveAttribute('aria-current', 'true');
    await expect(page.getByLabel('Mensagem')).toBeEnabled();
    await expect(page.getByRole('log', { name: 'Mensagens' })).toContainText('Ótimo. Qualquer coisa me avisa.');
    const header = page.locator('.chat-header');
    await expect(header.getByRole('heading', { name: 'Ana Souza' })).toBeVisible();
    await expect(header.getByText('Agente')).toBeVisible();
  });

  test('duas seções fixas, cada uma por última atividade, com não lidas visíveis nas duas', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== '1920', 'cenário pedido em 1920');

    await enterAs(page, USERS.carla, { reset: true });
    const sidebar = page.getByLabel('Lista de conversas');
    await expect(sidebar.getByRole('heading', { level: 2 })).toHaveText(['Grupos e supervisão', 'Colegas']);
    const priority = sidebar.getByRole('region', { name: 'Grupos e supervisão' });
    const colleagues = sidebar.getByRole('region', { name: 'Colegas' });
    await expect(priority.locator('.conversation-title')).toHaveText(['Ana Souza', 'Bruno Costa', 'Camila Ribeiro']);
    await expect(colleagues.locator('.conversation-title')).toHaveText(['Marcos Dono']);
    // A Ana está aberta (lida); a lista abre nela por ter mensagens.
    await expect(priority.getByRole('button', { name: /Ana Souza/ }).locator('.unread-badge')).toHaveCount(0);
    await expect(colleagues.getByRole('button', { name: /Marcos Dono/ }).locator('.unread-badge')).toBeVisible();
  });

  test('a busca e o filtro Não lidas funcionam sobre a lista real', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== '1920', 'cenário pedido em 1920');

    await enterAs(page, USERS.carla, { reset: true });
    const sidebar = page.getByLabel('Lista de conversas');
    await sidebar.getByRole('searchbox', { name: 'Pesquisar conversa' }).fill('marcos');
    await expect(sidebar.locator('.conversation-title')).toHaveText(['Marcos Dono']);
    await sidebar.getByRole('searchbox', { name: 'Pesquisar conversa' }).fill('zzzz-inexistente');
    await expect(sidebar.getByText('Nenhum resultado encontrado')).toBeVisible();
    await sidebar.getByRole('searchbox', { name: 'Pesquisar conversa' }).fill('');
    await sidebar.getByRole('button', { name: 'Não lidas' }).click();
    await expect(sidebar.locator('.conversation-title')).toHaveText(['Marcos Dono']);
  });

  test('sem conversas por causa da falha de conexão: alerta e nada de composer', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== '1920', 'cenário pedido em 1920');
    await enterAs(page, USERS.carla, { reset: true, query: 'falha=conectar' });
    await expect(page.getByRole('alert')).toBeVisible();
    await expect(page.getByLabel('Lista de conversas')).toContainText('Não foi possível carregar as conversas.');
    await expect(page.getByLabel('Mensagem')).toHaveCount(0);
  });

  test('no carregamento inicial a lista diz Conectando', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== '1920', 'cenário pedido em 1920');
    await enterAs(page, USERS.carla, { reset: true, query: 'conexao=segurar' });
    await expect(page.getByLabel('Lista de conversas')).toContainText('Conectando…');
    await expect(page.getByText('Reconectando')).toHaveCount(0);
    await expect(page.getByLabel('Mensagem')).toHaveCount(0);
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

  test('envia mensagem e preserva o histórico da conversa', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== '1920', 'cenário pedido em 1920');
    await enterAs(page, USERS.carla, { reset: true });
    await openConversation(page, /Bruno Costa/);
    await page.getByLabel('Mensagem').fill('oi da conversa direta');
    await page.getByRole('button', { name: 'Enviar' }).click();
    await expect(page.getByRole('log', { name: 'Mensagens' }).getByText('oi da conversa direta')).toBeVisible();
    await expect(page.getByLabel('Enviada').last()).toBeVisible();
    await expect(page.getByRole('button', { name: /Bruno Costa/ })).toContainText('oi da conversa direta');
    // Outra conversa não mostra o texto; voltar traz o histórico de volta.
    await openConversation(page, /Camila Ribeiro/);
    await expect(page.getByRole('log', { name: 'Mensagens' }).getByText('oi da conversa direta')).toHaveCount(0);
    await openConversation(page, /Bruno Costa/);
    await expect(page.getByRole('log', { name: 'Mensagens' }).getByText('oi da conversa direta')).toBeVisible();
  });

  test('caudas dos balões usam a cor do grupo e só na primeira mensagem', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== '1920', 'cenário visual em 1920');
    await enterAs(page, USERS.carla, { reset: true });
    await openConversation(page, /Bruno Costa/);
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

  test('o erro de upload de uma conversa não aparece em outra', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== '1920', 'cenário pedido em 1920');
    await enterAs(page, USERS.carla, { reset: true, query: 'falha=upload' });
    await openConversation(page, /Bruno Costa/);
    await page.locator('.wa-chat input[type="file"]').setInputFiles({
      name: 'exame.png',
      mimeType: 'image/png',
      buffer: Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
        'base64',
      ),
    });
    await page.getByRole('button', { name: 'Enviar' }).click();
    await expect(page.getByRole('alert')).toHaveText(/Falha ao enviar exame.png/);
    await openConversation(page, /Camila Ribeiro/);
    await expect(page.getByRole('alert')).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Bruno Costa/ }).locator('.live-activity-badge.is-error')).toBeVisible();
    await openConversation(page, /Bruno Costa/);
    await expect(page.getByRole('alert')).toBeVisible();
  });
});

test.describe('navegação mobile', () => {
  test('abre na lista, o item leva ao chat e Voltar / histórico do navegador voltam', async ({ page }, testInfo) => {
    test.skip(!isMobileProject(testInfo), 'só em 390×844');

    await enterAs(page, USERS.carla, { reset: true });
    await expect(page.getByLabel('Lista de conversas')).toBeVisible();
    await expect(page.getByLabel('Mensagem')).toBeHidden();
    await expect(page.getByRole('region', { name: 'Grupos e supervisão' })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Colegas' })).toBeVisible();

    await page.getByRole('button', { name: /Bruno Costa/ }).click();
    await expect(page.getByLabel('Mensagem')).toBeVisible();
    await expect(page.getByRole('button', { name: /^Voltar/ })).toBeVisible();

    await page.getByRole('button', { name: /^Voltar/ }).click();
    await expect(page.getByLabel('Lista de conversas')).toBeVisible();
    await expect(page.getByLabel('Mensagem')).toBeHidden();

    await page.getByRole('button', { name: /Bruno Costa/ }).click();
    await expect(page.getByLabel('Mensagem')).toBeVisible();
    await page.goBack();
    await expect(page.getByLabel('Lista de conversas')).toBeVisible();
    await expect(page.getByLabel('Mensagem')).toBeHidden();
  });

  test('ao voltar, seleção e foco voltam ao item de origem', async ({ page }, testInfo) => {
    test.skip(!isMobileProject(testInfo), 'só em 390×844');
    await enterAs(page, USERS.carla, { reset: true });
    await expect(page.getByLabel('Lista de conversas')).toBeVisible();
    const item = page.getByRole('button', { name: /Camila Ribeiro/ });
    await item.click();
    await expect(page.getByLabel('Mensagem')).toBeVisible();
    await page.getByRole('button', { name: /^Voltar/ }).click();
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

    await enterAs(page, USERS.carla, { reset: true });
    await expect(page.getByLabel('Lista de conversas')).toBeVisible();

    const item = page.getByRole('button', { name: /Bruno Costa/ });
    await item.focus();
    await expect(item).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.locator('.chat-header')).toBeFocused();

    await page.getByRole('button', { name: /^Voltar/ }).click();
    await expect(item).toBeFocused();
  });

  test('Trocar usuário no mobile volta ao Entrar como', async ({ page }, testInfo) => {
    test.skip(!isMobileProject(testInfo), 'só em 390×844');
    await enterAs(page, USERS.carla, { reset: true });
    await page.getByRole('button', { name: /Bruno Costa/ }).click();
    await page.getByRole('button', { name: /^Voltar/ }).click();
    await page.getByRole('button', { name: 'Trocar usuário' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Entrar como' })).toBeVisible();
    await page.getByRole('button', { name: /Rafael Lima/ }).click();
    await expect(page.getByLabel('Lista de conversas')).toBeVisible();
    await expect(page.getByLabel('Mensagem')).toBeHidden();
  });
});

test.describe('conexão lenta', () => {
  test('?conexao=lenta mostra Conectando e depois habilita o composer', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== '1920', 'cenário pedido em 1920');
    await enterAs(page, USERS.carla, { reset: true, query: 'conexao=lenta' });
    await expect(page.getByLabel('Lista de conversas')).toContainText('Conectando…');
    await expect(page.getByLabel('Mensagem')).toBeEnabled();
    await expect(page.getByLabel('Lista de conversas')).not.toContainText('Conectando…');
  });
});
