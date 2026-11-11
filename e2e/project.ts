import { expect, type Page, type TestInfo } from '@playwright/test';

export const PAGE_PROJECTS = ['1366', '1920', '2560', '390'] as const;
export const DESKTOP_PROJECTS = ['1366', '1920', '2560'] as const;

export function isWidgetProject(testInfo: TestInfo): boolean {
  return testInfo.project.name === 'widget';
}

export function isMobileProject(testInfo: TestInfo): boolean {
  return testInfo.project.name === '390';
}

export function isPageProject(testInfo: TestInfo): boolean {
  return (PAGE_PROJECTS as readonly string[]).includes(testInfo.project.name);
}

export function chatFileInput(page: Page) {
  return page.locator('.wa-chat input[type="file"]');
}

export async function openLiveChat(page: Page, testInfo: TestInfo, extraQuery = ''): Promise<void> {
  const extra = extraQuery.replace(/^\?/, '');
  if (isWidgetProject(testInfo)) {
    const params = new URLSearchParams(extra);
    params.set('modo', 'widget');
    await page.goto(`/?${params.toString()}`);
    await page.getByRole('button', { name: /Abrir chat de atendimento/ }).click();
  } else {
    const params = new URLSearchParams(extra);
    if (!params.has('nome')) {
      params.set('nome', 'Maria Silva');
    }
    await page.goto(`/?${params.toString()}`);
    if (isMobileProject(testInfo)) {
      await page.getByRole('button', { name: /ICS Pré-atendimento/ }).click();
    }
  }
  await expect(page.getByText(/Como posso ajudar/)).toBeVisible();
}
