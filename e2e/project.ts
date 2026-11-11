import type { TestInfo } from '@playwright/test';

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
