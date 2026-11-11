import { expect, test } from '@playwright/test';
import { isPageProject, isWidgetProject } from './project';

const GRAY = 'rgb(209, 215, 219)';

test.describe('tela cheia no modo página', () => {
  test('o .wa-shell preenche o viewport sem faixa cinza nem scroll horizontal', async ({ page }, testInfo) => {
    test.skip(!isPageProject(testInfo), 'só no modo página');

    const viewport = page.viewportSize();
    expect(viewport).not.toBeNull();
    if (!viewport) {
      return;
    }

    await page.goto('/?nome=Maria%20Silva');
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
});

test.describe('widget', () => {
  test('o quadro do widget permanece 380×640', async ({ page }, testInfo) => {
    test.skip(!isWidgetProject(testInfo), 'só no projeto widget');

    await page.goto('/?modo=widget');
    await page.getByRole('button', { name: /Abrir chat de atendimento/ }).click();
    const frame = page.locator('.widget-frame');
    await expect(frame).toBeVisible();
    const box = await frame.boundingBox();
    expect(box).not.toBeNull();
    if (!box) {
      return;
    }
    expect(Math.abs(box.width - 380)).toBeLessThanOrEqual(1);
    expect(Math.abs(box.height - 640)).toBeLessThanOrEqual(1);
    await expect(page.locator('.wa-sidebar')).toHaveCount(0);
  });
});
