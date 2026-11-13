import { expect, test } from '@playwright/test';
import { isPageProject } from './project';

const GRAY = 'rgb(209, 215, 219)';

test.describe('tela cheia no modo página', () => {
  test('o .wa-shell preenche o viewport sem faixa cinza nem scroll horizontal', async ({ page }, testInfo) => {
    test.skip(!isPageProject(testInfo), 'só no modo página');

    const viewport = page.viewportSize();
    expect(viewport).not.toBeNull();
    if (!viewport) {
      return;
    }

    await page.goto('/');
    const shell = page.locator('.wa-shell');
    await expect(shell).toBeVisible();

    const box = await shell.boundingBox();
    expect(box).not.toBeNull();
    if (!box) {
      return;
    }

    expect(Math.abs(box.width - viewport.width)).toBeLessThanOrEqual(1);
    expect(Math.abs(box.height - viewport.height)).toBeLessThanOrEqual(1);
    expect(Math.abs(box.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(box.y)).toBeLessThanOrEqual(1);

    const overflowX = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflowX).toBeLessThanOrEqual(1);

    const backgrounds = await page.evaluate(() => {
      const pageShell = document.querySelector('.page-shell');
      return {
        html: getComputedStyle(document.documentElement).backgroundColor,
        body: getComputedStyle(document.body).backgroundColor,
        page: pageShell ? getComputedStyle(pageShell).backgroundColor : '',
      };
    });
    expect(backgrounds.html).not.toBe(GRAY);
    expect(backgrounds.body).not.toBe(GRAY);
    expect(backgrounds.page).not.toBe(GRAY);
  });

  test('preenche 900, 1024 e 3840 px sem faixa cinza', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== '1920', 'varia o viewport uma vez só');

    for (const width of [900, 1024, 3840]) {
      await page.setViewportSize({ width, height: 1080 });
      await page.goto('/');
      const shell = page.locator('.wa-shell');
      await expect(shell).toBeVisible();
      const box = await shell.boundingBox();
      expect(box, `${String(width)}px`).not.toBeNull();
      if (!box) {
        continue;
      }
      expect(Math.abs(box.width - width), `${String(width)}px largura`).toBeLessThanOrEqual(1);
      expect(Math.abs(box.height - 1080), `${String(width)}px altura`).toBeLessThanOrEqual(1);
      expect(Math.abs(box.x)).toBeLessThanOrEqual(1);
      const overflowX = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflowX, `${String(width)}px overflow`).toBeLessThanOrEqual(1);
      const pageBg = await page.evaluate(() => {
        const pageShell = document.querySelector('.page-shell');
        return pageShell ? getComputedStyle(pageShell).backgroundColor : '';
      });
      expect(pageBg, `${String(width)}px fundo`).not.toBe(GRAY);
    }
  });
});

