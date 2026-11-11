import { expect, test, type Locator } from '@playwright/test';
import { contrastRatioFromCss } from '../src/styles/contrast';

async function paintedColors(locator: Locator): Promise<{ color: string; background: string }> {
  return locator.evaluate((node) => {
    const style = getComputedStyle(node);
    let painted: Element | null = node;
    let background = style.backgroundColor;
    while (painted && (/rgba\(\s*0,\s*0,\s*0,\s*0\s*\)/.test(background) || background === 'transparent')) {
      painted = painted.parentElement;
      background = painted ? getComputedStyle(painted).backgroundColor : background;
    }
    return { color: style.color, background };
  });
}

test.describe('contraste computado', () => {
  test('texto, badges, erro real, foco e ativo passam no WCAG', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== '1920', 'cenário de contraste em 1920');

    await page.goto('/?nome=Maria%20Silva&falha=conectar');
    const alert = page.getByRole('alert');
    await expect(alert).toBeVisible();
    await expect(alert.locator('p')).toHaveText(/conectar/i);

    const active = page.getByRole('button', { name: /ICS Pré-atendimento/ });
    await expect(active).toHaveClass(/is-active/);
    const activeTitle = await paintedColors(active.locator('.conversation-title'));
    expect(contrastRatioFromCss(activeTitle.color, activeTitle.background)).toBeGreaterThanOrEqual(4.5);

    const errorBadge = await paintedColors(page.locator('.live-activity-badge.is-error'));
    expect(contrastRatioFromCss(errorBadge.color, errorBadge.background)).toBeGreaterThanOrEqual(4.5);

    const errorText = await paintedColors(alert.locator('p'));
    expect(contrastRatioFromCss(errorText.color, errorText.background)).toBeGreaterThanOrEqual(4.5);

    const demoBadge = await paintedColors(page.locator('.demo-badge').first());
    expect(contrastRatioFromCss(demoBadge.color, demoBadge.background)).toBeGreaterThanOrEqual(4.5);

    const history = page.getByRole('button', { name: /Atendimento anterior/ });
    await page.getByRole('searchbox', { name: 'Pesquisar conversa' }).focus();
    for (let step = 0; step < 16; step += 1) {
      const focused = await history.evaluate((node) => node === document.activeElement);
      if (focused) {
        break;
      }
      await page.keyboard.press('Tab');
    }
    await expect(history).toBeFocused();
    const focusColors = await history.evaluate((node) => {
      const style = getComputedStyle(node);
      let painted: Element | null = node;
      let background = style.backgroundColor;
      while (painted && (/rgba\(\s*0,\s*0,\s*0,\s*0\s*\)/.test(background) || background === 'transparent')) {
        painted = painted.parentElement;
        background = painted ? getComputedStyle(painted).backgroundColor : background;
      }
      return {
        background,
        outlineStyle: style.outlineStyle,
        outlineWidth: style.outlineWidth,
        outlineColor: style.outlineColor,
      };
    });
    expect(focusColors.outlineStyle).not.toBe('none');
    expect(Number.parseFloat(focusColors.outlineWidth)).toBeGreaterThan(0);
    expect(contrastRatioFromCss(focusColors.outlineColor, focusColors.background)).toBeGreaterThanOrEqual(3);
  });
});
