import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { pngFile } from './files';
import { chatFileInput, enterAs, openConversation, USERS } from './project';

async function checkA11y(page: Page) {
  const result = await new AxeBuilder({ page }).analyze();
  expect(result.violations.filter((violation) => violation.impact === 'serious' || violation.impact === 'critical')).toEqual([]);
}

test('cria grupo da ilha, compartilha mídia e preserva histórico após remoção', async ({ context }, info) => {
  test.skip(!['1366', '390'].includes(info.project.name), 'exercita desktop e mobile');
  const owner = await context.newPage();
  await enterAs(owner, USERS.carla, { reset: true });
  await owner.getByLabel('Ilha do grupo').selectOption({ label: 'Norte' });
  await owner.getByRole('button', { name: 'Novo grupo' }).click();
  const create = owner.getByRole('dialog', { name: 'Novo grupo' });
  await expect(create).toBeVisible();
  await checkA11y(owner);
  await create.getByRole('button', { name: 'Próximo' }).click();
  await expect(create.getByRole('checkbox', { name: 'Ana Souza' })).toBeChecked();
  await expect(create.getByRole('checkbox', { name: 'Bruno Costa' })).toBeChecked();
  await create.getByRole('button', { name: 'Próximo' }).click();
  await create.getByLabel('Nome do grupo').fill('Equipe Norte');
  await create.getByRole('button', { name: 'Criar grupo' }).click();
  await expect(owner.getByRole('heading', { name: 'Equipe Norte' })).toBeVisible();
  await checkA11y(owner);

  const agent = await context.newPage();
  await enterAs(agent, USERS.ana);
  const sidebar = agent.getByLabel('Lista de conversas');
  await expect(sidebar.getByRole('button', { name: /Equipe Norte/ })).toBeVisible();
  await expect(sidebar.locator('section[aria-labelledby="section-priority"] .conversation-item').first()).toContainText('Equipe Norte');
  await expect(agent.getByRole('button', { name: 'Novo grupo' })).toHaveCount(0);
  await openConversation(agent, /Equipe Norte/);

  await chatFileInput(owner).setInputFiles(pngFile());
  await owner.getByLabel('Legenda').fill('Foto da equipe');
  await owner.getByRole('button', { name: 'Enviar' }).click();
  await expect(agent.getByRole('img', { name: 'Foto da equipe' })).toBeVisible();
  await expect(agent.locator('.message-list').getByText('Foto da equipe')).toBeVisible();
  await checkA11y(agent);
  await owner.screenshot({ path: info.outputPath(`grupo-${info.project.name}.png`) });

  await owner.getByRole('button', { name: 'Editar grupo' }).click();
  const edit = owner.getByRole('dialog', { name: 'Editar grupo' });
  await expect(edit).toBeVisible();
  await edit.getByRole('checkbox', { name: 'Ana Souza' }).uncheck();
  await edit.getByRole('button', { name: 'Salvar alterações' }).click();
  await expect(agent.getByText(/histórico está disponível somente para leitura/i)).toBeVisible();
  await expect(agent.getByRole('textbox', { name: /mensagem/i })).toBeDisabled();
  await expect(agent.locator('.message-list').getByText('Foto da equipe')).toBeVisible();
  await owner.getByRole('textbox', { name: /mensagem/i }).fill('Mensagem após remoção');
  await owner.getByRole('button', { name: 'Enviar' }).click();
  await expect(owner.locator('.message-list').getByText('Mensagem após remoção')).toBeVisible();
  await expect(agent.locator('.message-list').getByText('Mensagem após remoção')).toHaveCount(0);
});



test('grupo de ilha permite ver membros sem editá-los', async ({ page }, info) => {
  test.skip(!['1366', '390'].includes(info.project.name));
  await enterAs(page, USERS.carla, { reset: true });
  await openConversation(page, /Ilha Norte/);
  await page.getByRole('button', { name: 'Ver membros' }).click();
  const dialog = page.getByRole('dialog', { name: 'Membros do grupo' });
  await expect(dialog.getByText(/sincronizados com a ilha/)).toBeVisible();
  await expect(dialog.getByRole('checkbox', { name: 'Ana Souza' })).toBeDisabled();
  await checkA11y(page);
});
