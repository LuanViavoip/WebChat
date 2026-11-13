import { expect, type Page, type TestInfo } from '@playwright/test';

export const DESKTOP_PROJECTS = ['1366', '1920', '2560'] as const;

export function isMobileProject(testInfo: TestInfo): boolean {
  return testInfo.project.name === '390';
}

export function chatFileInput(page: Page) {
  return page.locator('.wa-chat input[type="file"]');
}

export async function openLiveChat(page: Page, testInfo: TestInfo, extraQuery = ''): Promise<void> {
  const extra = extraQuery.replace(/^\?/, '');
  const params = new URLSearchParams(extra);
  await page.goto(`/?${params.toString()}`);
  if (isMobileProject(testInfo)) {
    await page.getByRole('button', { name: /Conversa de teste/ }).click();
  }
  await expect(page.getByRole('textbox', { name: /mensagem/i })).toBeEnabled();
}
