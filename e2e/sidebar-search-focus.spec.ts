import { expect, test } from '@playwright/test';

test('Tab até a busca mostra outline visível no contêiner', async ({ page }) => {
  await page.goto('/?nome=Maria%20Silva');
  const search = page.getByRole('searchbox', { name: 'Pesquisar conversa' });
  await search.waitFor();

  for (let step = 0; step < 16; step += 1) {
    const focused = await search.evaluate((node) => node === document.activeElement);
    if (focused) {
      break;
    }
    await page.keyboard.press('Tab');
  }

  await expect(search).toBeFocused();

  const outline = await page.locator('.sidebar-search').evaluate((node) => {
    const style = getComputedStyle(node);
    return { outlineStyle: style.outlineStyle, outlineWidth: style.outlineWidth };
  });

  expect(outline.outlineStyle).not.toBe('none');
  expect(Number.parseFloat(outline.outlineWidth)).toBeGreaterThan(0);
});
