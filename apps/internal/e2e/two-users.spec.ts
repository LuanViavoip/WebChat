import { expect, test } from '@playwright/test';
import { enterAs, openConversation, USERS } from './project';

test.describe('dois usuários no mesmo servidor simulado', () => {
  test.beforeEach(({ page: _page }, testInfo) => {
    test.skip(testInfo.project.name !== '1366', 'duas páginas só no projeto 1366');
  });

  test('a supervisora envia ao agente, ele vê a não lida, abre, e ela vê Lida', async ({ context }) => {
    const carla = await context.newPage();
    const bruno = await context.newPage();
    await enterAs(carla, USERS.carla, { reset: true });
    await enterAs(bruno, USERS.bruno);

    // Bruno está olhando a conversa com a Ana: a da Carla chega como não lida.
    await openConversation(bruno, /Ana Souza/);
    await openConversation(carla, /Bruno Costa/);
    await carla.getByLabel('Mensagem').fill('Bruno, pode cobrir o Norte hoje?');
    await carla.getByRole('button', { name: 'Enviar' }).click();

    const carlaItem = bruno.getByLabel('Lista de conversas').getByRole('button', { name: /Carla Mendes/ });
    await expect(carlaItem).toHaveAccessibleName(/1 mensagem não lida/);
    await expect(carlaItem).toContainText('Bruno, pode cobrir o Norte hoje?');
    await expect(carla.getByLabel('Entregue').last()).toBeVisible();

    await carlaItem.click();
    await expect(bruno.getByRole('log', { name: 'Mensagens' }).getByText('Bruno, pode cobrir o Norte hoje?')).toBeVisible();
    await expect(carlaItem).not.toHaveAccessibleName(/não lida/);

    await expect(carla.getByLabel('Lida').last()).toBeVisible();
    await expect(bruno.getByRole('heading', { level: 2, name: 'Carla Mendes' })).toBeVisible();
  });

  test('agente conversa com agente: Bruno abre uma direta com Camila, envia e Camila recebe e responde', async ({
    context,
  }) => {
    const bruno = await context.newPage();
    const camila = await context.newPage();
    await enterAs(bruno, USERS.bruno, { reset: true });
    await enterAs(camila, USERS.camila);

    await bruno.getByRole('button', { name: 'Nova conversa' }).click();
    await bruno.getByRole('dialog', { name: 'Nova conversa' }).getByRole('button', { name: /Camila Ribeiro/ }).click();
    await expect(bruno.getByRole('heading', { level: 2, name: 'Camila Ribeiro' })).toBeVisible();
    await expect(bruno.getByRole('textbox', { name: /mensagem/i })).toBeEnabled();
    await bruno.getByLabel('Mensagem').fill('Camila, você cobre o meu plantão sábado?');
    await bruno.getByRole('button', { name: 'Enviar' }).click();

    // Camila estava com a conversa da Carla à vista: a do Bruno aparece em Colegas e chega como não lida.
    const brunoItem = camila.getByLabel('Lista de conversas').getByRole('button', { name: /Bruno Costa/ });
    await expect(brunoItem).toBeVisible();
    await expect(brunoItem).toHaveAccessibleName(/1 mensagem não lida/);
    await brunoItem.click();
    await expect(camila.getByRole('log', { name: 'Mensagens' }).getByText('Camila, você cobre o meu plantão sábado?')).toBeVisible();

    await camila.getByLabel('Mensagem').fill('Cubro sim.');
    await camila.getByRole('button', { name: 'Enviar' }).click();
    await expect(bruno.getByRole('log', { name: 'Mensagens' }).getByText('Cubro sim.')).toBeVisible();
    await expect(bruno.getByLabel('Lida').last()).toBeVisible();
  });

  test('para o agente, a direta com o supervisor fica em Grupos e supervisão, acima de Colegas', async ({
    context,
  }) => {
    const bruno = await context.newPage();
    await enterAs(bruno, USERS.bruno, { reset: true });
    const sidebar = bruno.getByLabel('Lista de conversas');
    const priority = sidebar.getByRole('region', { name: 'Grupos e supervisão' });
    const colleagues = sidebar.getByRole('region', { name: 'Colegas' });
    await expect(priority.getByRole('button', { name: /Carla Mendes/ })).toBeVisible();
    await expect(colleagues.getByRole('button', { name: /Ana Souza/ })).toBeVisible();
    await expect(priority.getByRole('button', { name: /Ana Souza/ })).toHaveCount(0);
    const priorityBox = await priority.boundingBox();
    const colleaguesBox = await colleagues.boundingBox();
    expect(priorityBox).not.toBeNull();
    expect(colleaguesBox).not.toBeNull();
    if (priorityBox && colleaguesBox) {
      expect(priorityBox.y).toBeLessThan(colleaguesBox.y);
    }
  });
});
