import { expect, test } from '@playwright/test';
import { contrastRatioFromCss } from '../src/styles/contrast';

test.describe('contraste computado', () => {
  test('erro, foco e item ativo passam no WCAG', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== '1920', 'cenário de contraste em 1920');

    await page.goto('/?nome=Maria%20Silva');
    await expect(page.getByText(/Como posso ajudar/)).toBeVisible();

    const active = page.getByRole('button', { name: /ICS Pré-atendimento/ });
    const activeColors = await active.evaluate((node) => {
      const style = getComputedStyle(node);
      return { color: style.color, background: style.backgroundColor };
    });
    expect(contrastRatioFromCss(activeColors.color, activeColors.background)).toBeGreaterThanOrEqual(4.5);

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

    const errorColors = await page.evaluate(() => {
      const banner = document.createElement('div');
      banner.className = 'session-banner session-banner-error';
      banner.innerHTML = '<p>Falha ao conectar</p>';
      document.querySelector('.wa-chat')?.append(banner);
      const style = getComputedStyle(banner);
      const text = banner.querySelector('p');
      const textStyle = text ? getComputedStyle(text) : style;
      const result = { color: textStyle.color, background: style.backgroundColor };
      banner.remove();
      return result;
    });
    expect(contrastRatioFromCss(errorColors.color, errorColors.background)).toBeGreaterThanOrEqual(4.5);
  });
});
