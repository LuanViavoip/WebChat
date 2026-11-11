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

  test('reload preserva a conversa selecionada', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== '1920', 'cenário pedido em 1920');
    await page.goto('/?nome=Maria%20Silva');
    await expect(page.getByText(/Como posso ajudar/)).toBeVisible();
    await page.getByRole('button', { name: /Atendimento anterior/ }).click();
    await expect(page.getByText(/remarcar a consulta da clínica da família/)).toBeVisible();
    await page.reload();
    await expect(page.getByText(/remarcar a consulta da clínica da família/)).toBeVisible();
    await expect(page.getByRole('button', { name: /Atendimento anterior/ })).toHaveAttribute('aria-current', 'true');
  });

  test('voltar e avançar restauram a conversa certa', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== '1920', 'cenário pedido em 1920');

    await page.goto('/?nome=Maria%20Silva');
    await expect(page.getByText(/Como posso ajudar/)).toBeVisible();

    await page.getByRole('button', { name: /Atendimento anterior/ }).click();
    await expect(page.getByText(/remarcar a consulta da clínica da família/)).toBeVisible();

    await page.getByRole('button', { name: /Exames e vacinas/ }).click();
    await expect(page.getByText(/campanha de influenza/)).toBeVisible();

    await page.goBack();
    await expect(page.getByText(/remarcar a consulta da clínica da família/)).toBeVisible();
    await expect(page.getByRole('button', { name: /Atendimento anterior/ })).toHaveAttribute('aria-current', 'true');

    await page.goForward();
    await expect(page.getByText(/campanha de influenza/)).toBeVisible();
    await expect(page.getByRole('button', { name: /Exames e vacinas/ })).toHaveAttribute('aria-current', 'true');
  });

  test('preserva o rascunho ao trocar de conversa e voltar', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== '1920', 'cenário pedido em 1920');
    await page.goto('/?nome=Maria%20Silva');
    await expect(page.getByText(/Como posso ajudar/)).toBeVisible();
    await page.getByLabel('Mensagem').fill('quero remarcar amanhã');
    await page.getByRole('button', { name: /Atendimento anterior/ }).click();
    await expect(page.getByText(/conversa fictícia para demonstração/i)).toBeVisible();
    await page.getByRole('button', { name: /ICS Pré-atendimento/ }).click();
    await expect(page.getByLabel('Mensagem')).toHaveValue('quero remarcar amanhã');
  });

  test('mostra nova mensagem na lista quando a resposta chega no histórico', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== '1920', 'cenário pedido em 1920');
    await page.goto('/?nome=Maria%20Silva');
    await expect(page.getByText(/Como posso ajudar/)).toBeVisible();
    await page.getByLabel('Mensagem').fill('2');
    await page.getByRole('button', { name: 'Enviar' }).click();
    await page.getByRole('button', { name: /Atendimento anterior/ }).click();
    await expect(page.locator('.live-activity-badge.is-unseen')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole('button', { name: /ICS Pré-atendimento/ })).toHaveAccessibleName(/nova mensagem/i);
    await page.getByRole('button', { name: /ICS Pré-atendimento/ }).click();
    await expect(page.locator('.live-activity-badge.is-unseen')).toHaveCount(0);
  });

  test('envia mensagem, troca de conversa e preserva o histórico ao vivo', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== '1920', 'cenário pedido em 1920');
    await page.goto('/?nome=Maria%20Silva');
    await expect(page.getByText(/Como posso ajudar/)).toBeVisible();
    await page.getByLabel('Mensagem').fill('2');
    await page.getByRole('button', { name: 'Enviar' }).click();
    await expect(page.getByRole('log', { name: 'Mensagens' }).getByText('2', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: /Exames e vacinas/ }).click();
    await expect(page.getByRole('log', { name: 'Mensagens' }).getByText(/campanha de influenza/i)).toBeVisible();
    await page.getByRole('button', { name: /ICS Pré-atendimento/ }).click();
    await expect(page.getByRole('log', { name: 'Mensagens' }).getByText('2', { exact: true })).toBeVisible();
  });

  test('itens e transcrição de histórico se identificam como demonstração', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== '1920', 'cenário visual em 1920');
    await page.goto('/?nome=Maria%20Silva');
    await expect(page.getByText('Demonstração')).toHaveCount(2);
    await page.getByRole('button', { name: /Atendimento anterior/ }).click();
    await expect(page.getByText(/conversa fictícia para demonstração/i)).toBeVisible();
  });

  test('caudas dos balões usam a cor do grupo e só na primeira mensagem', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== '1920', 'cenário visual em 1920');
    await page.goto('/?nome=Maria%20Silva');
    await expect(page.getByText(/Como posso ajudar/)).toBeVisible();
    const welcome = page.locator('.bubble.has-tail').first();
    await expect(welcome).toBeVisible();
    const tail = await welcome.evaluate((node) => {
      const after = getComputedStyle(node, '::after');
      const self = getComputedStyle(node);
      return { content: after.content, background: after.backgroundColor, bubble: self.backgroundColor };
    });
    expect(tail.content).not.toBe('none');
    expect(tail.background).toBe(tail.bubble);

    await page.getByRole('button', { name: /Atendimento anterior/ }).click();
    await expect(page.getByText(/remarcar a consulta da clínica da família/)).toBeVisible();
    await expect(page.locator('.bubble').filter({ hasText: 'Encaminhei o pedido de remarcação' })).toHaveClass(
      /has-tail/,
    );
    await expect(
      page.locator('.bubble').filter({ hasText: 'Se a unidade não tiver vaga na terça' }),
    ).not.toHaveClass(/has-tail/);
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

  test('ao voltar, seleção e foco voltam ao item de origem', async ({ page }, testInfo) => {
    test.skip(!isMobileProject(testInfo), 'só em 390×844');
    await page.goto('/?nome=Maria%20Silva');
    await expect(page.getByLabel('Lista de conversas')).toBeVisible();

    const origins = [
      {
        name: /Atendimento anterior/,
        open: () => expect(page.getByRole('log').getByText(/remarcar a consulta da clínica da família/)).toBeVisible(),
      },
      {
        name: /Exames e vacinas/,
        open: () => expect(page.getByRole('log').getByText(/campanha de influenza/i)).toBeVisible(),
      },
      {
        name: /ICS Pré-atendimento/,
        open: () => expect(page.getByLabel('Mensagem')).toBeVisible(),
      },
    ];

    for (const origin of origins) {
      const item = page.getByRole('button', { name: origin.name });
      await item.click();
      await origin.open();
      await page.getByRole('button', { name: 'Voltar' }).click();
      await expect(page.getByLabel('Lista de conversas')).toBeVisible();
      await expect(item).toHaveAttribute('aria-current', 'true');
      await expect(item).toBeFocused();
    }

    for (const origin of origins) {
      const item = page.getByRole('button', { name: origin.name });
      await item.click();
      await origin.open();
      await page.goBack();
      await expect(page.getByLabel('Lista de conversas')).toBeVisible();
      await expect(item).toHaveAttribute('aria-current', 'true');
      await expect(item).toBeFocused();
    }
  });

  test('mostra nova mensagem quando a resposta chega com o histórico aberto', async ({ page }, testInfo) => {
    test.skip(!isMobileProject(testInfo), 'só em 390×844');
    await page.goto('/?nome=Maria%20Silva');
    await page.getByRole('button', { name: /ICS Pré-atendimento/ }).click();
    await expect(page.getByLabel('Mensagem')).toBeVisible();
    await page.getByLabel('Mensagem').fill('2');
    await page.getByRole('button', { name: 'Enviar' }).click();
    await page.getByRole('button', { name: 'Voltar' }).click();
    await page.getByRole('button', { name: /Atendimento anterior/ }).click();
    await expect(page.getByRole('button', { name: /voltar, nova mensagem/i })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(/nova mensagem no ics pré-atendimento/i)).toBeVisible();
  });

  test('teclado move o foco ao abrir o chat e o devolve ao voltar', async ({ page }, testInfo) => {
    test.skip(!isMobileProject(testInfo), 'só em 390×844');

    await page.goto('/?nome=Maria%20Silva');
    await expect(page.getByLabel('Lista de conversas')).toBeVisible();

    const liveItem = page.getByRole('button', { name: /ICS Pré-atendimento/ });
    await liveItem.focus();
    await expect(liveItem).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.locator('.chat-header')).toBeFocused();

    await page.getByRole('button', { name: 'Voltar' }).click();
    await expect(liveItem).toBeFocused();

    const historyItem = page.getByRole('button', { name: /Atendimento anterior/ });
    await historyItem.focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('.chat-header')).toBeFocused();
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
