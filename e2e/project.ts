import { expect, type Page, type TestInfo } from '@playwright/test';

export const DESKTOP_PROJECTS = ['1366', '1920', '2560'] as const;

/** Ids estáveis da seed (src/transport/mock/seed.ts). */
export const USERS = {
  marcos: 'ics-marcos', // admin, ICS Saúde
  carla: 'ics-carla', // supervisora (Norte e Sul)
  rafael: 'ics-rafael', // supervisor (Exames)
  ana: 'ics-ana', // agente Norte
  bruno: 'ics-bruno', // agente Norte
  camila: 'ics-camila', // agente Sul
  diego: 'ics-diego', // agente Sul
  helena: 'bv-helena', // admin, Clínica Boa Vista
  otavio: 'bv-otavio', // supervisor, Clínica Boa Vista
  paula: 'bv-paula', // agente, Clínica Boa Vista
  rui: 'bv-rui', // agente, Clínica Boa Vista
} as const;

export function isMobileProject(testInfo: TestInfo): boolean {
  return testInfo.project.name === '390';
}

export function chatFileInput(page: Page) {
  return page.locator('.wa-chat input[type="file"]');
}

/**
 * Entra direto como um usuário da seed (`?como=`). `reset` zera o servidor simulado (localStorage do
 * context): use só na primeira página do cenário, senão apaga o que as outras abas já fizeram.
 */
export async function enterAs(
  page: Page,
  userId: string,
  options: { reset?: boolean; query?: string } = {},
): Promise<void> {
  const params = new URLSearchParams((options.query ?? '').replace(/^\?/, ''));
  params.set('como', userId);
  if (options.reset) {
    params.set('reset', '1');
  }
  await page.goto(`/?${params.toString()}`);
  await expect(page.getByLabel('Lista de conversas')).toBeVisible();
}

/** Abre a conversa com `name` (no mobile é o item que leva ao chat) e espera o composer ligado. */
export async function openConversation(page: Page, name: string | RegExp): Promise<void> {
  const item = page.getByLabel('Lista de conversas').getByRole('button', { name });
  const composer = page.getByRole('textbox', { name: /mensagem/i });
  await expect(item).toBeVisible();
  if ((await item.getAttribute('aria-current')) !== 'true' || !(await composer.isVisible())) {
    await item.click();
  }
  await expect(composer).toBeEnabled();
}

/** A direta Carla ↔ Bruno da seed: o cenário das mídias da Etapa 2. */
export async function openLiveChat(page: Page, _testInfo: TestInfo, extraQuery = ''): Promise<void> {
  await enterAs(page, USERS.carla, { reset: true, query: extraQuery });
  await openConversation(page, /Bruno Costa/);
}
