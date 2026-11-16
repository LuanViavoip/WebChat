import { expect, test, type Locator } from '@playwright/test';
import { contrastRatioFromCss } from '../src/styles/contrast';
import { chatFileInput, enterAs, openConversation, USERS } from './project';

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

    await enterAs(page, USERS.carla, { reset: true, query: 'falha=conectar' });
    const connectAlert = page.getByRole('alert');
    await expect(connectAlert).toBeVisible();
    await expect(connectAlert.locator('p')).toHaveText(/conectar/i);
    const connectText = await paintedColors(connectAlert.locator('p'));
    expect(contrastRatioFromCss(connectText.color, connectText.background)).toBeGreaterThanOrEqual(4.5);

    await enterAs(page, USERS.carla, { reset: true, query: 'falha=upload' });
    await openConversation(page, /Bruno Costa/);
    await chatFileInput(page).setInputFiles({
      name: 'exame.png',
      mimeType: 'image/png',
      buffer: Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
        'base64',
      ),
    });
    await page.getByRole('button', { name: 'Enviar' }).click();
    const alert = page.getByRole('alert');
    await expect(alert).toBeVisible();
    await expect(alert).toHaveText(/Falha ao enviar exame.png/);

    const active = page.getByRole('button', { name: /Bruno Costa/ });
    await expect(active).toHaveClass(/is-active/);
    const activeTitle = await paintedColors(active.locator('.conversation-title'));
    expect(contrastRatioFromCss(activeTitle.color, activeTitle.background)).toBeGreaterThanOrEqual(4.5);

    const sectionTitle = await paintedColors(page.locator('.conversation-section-title').first());
    expect(contrastRatioFromCss(sectionTitle.color, sectionTitle.background)).toBeGreaterThanOrEqual(4.5);

    const unread = await paintedColors(page.locator('.unread-badge').first());
    expect(contrastRatioFromCss(unread.color, unread.background)).toBeGreaterThanOrEqual(4.5);

    const identity = await paintedColors(page.locator('.sidebar-identity-role'));
    expect(contrastRatioFromCss(identity.color, identity.background)).toBeGreaterThanOrEqual(4.5);

    const errorBadge = await paintedColors(page.locator('.live-activity-badge.is-error'));
    expect(contrastRatioFromCss(errorBadge.color, errorBadge.background)).toBeGreaterThanOrEqual(4.5);

    const errorText = await paintedColors(alert);
    expect(contrastRatioFromCss(errorText.color, errorText.background)).toBeGreaterThanOrEqual(4.5);

    await page.getByRole('searchbox', { name: 'Pesquisar conversa' }).focus();
    for (let step = 0; step < 16; step += 1) {
      const focused = await active.evaluate((node) => node === document.activeElement);
      if (focused) {
        break;
      }
      await page.keyboard.press('Tab');
    }
    await expect(active).toBeFocused();
    const focusColors = await active.evaluate((node) => {
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

    await enterAs(page, USERS.carla, { reset: true });
    await openConversation(page, /Bruno Costa/);
    await page.locator('.wa-chat input[type="file"]').setInputFiles({
      name: 'guia.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from('%PDF-1.1\n%%EOF\n'),
    });
    await page.getByRole('button', { name: 'Enviar' }).click();
    const docMeta = await paintedColors(page.locator('.doc-card-meta').first());
    expect(contrastRatioFromCss(docMeta.color, docMeta.background)).toBeGreaterThanOrEqual(4.5);

    await page.locator('.wa-chat').evaluate((node) => {
      const transfer = new DataTransfer();
      transfer.items.add(new File([new Uint8Array([1, 2, 3, 4])], 'foto.png', { type: 'image/png' }));
      node.dispatchEvent(new DragEvent('dragenter', { bubbles: true, cancelable: true, dataTransfer: transfer }));
    });
    const overlay = await paintedColors(page.locator('.drop-overlay'));
    expect(contrastRatioFromCss(overlay.color, overlay.background)).toBeGreaterThanOrEqual(4.5);

    await page.locator('.wa-chat input[type="file"]').setInputFiles({
      name: 'foto.png',
      mimeType: 'image/png',
      buffer: Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
        'base64',
      ),
    });
    await page.getByRole('button', { name: 'Enviar' }).click();
    const thumb = page.getByRole('button', { name: 'Abrir foto em tela cheia' }).last();
    await thumb.focus();
    const thumbFocus = await thumb.evaluate((node) => {
      const style = getComputedStyle(node);
      let painted: Element | null = node;
      let background = style.backgroundColor;
      while (painted && (/rgba\(\s*0,\s*0,\s*0,\s*0\s*\)/.test(background) || background === 'transparent')) {
        painted = painted.parentElement;
        background = painted ? getComputedStyle(painted).backgroundColor : background;
      }
      return { outlineColor: style.outlineColor, background, outlineWidth: style.outlineWidth };
    });
    expect(Number.parseFloat(thumbFocus.outlineWidth)).toBeGreaterThan(0);
    expect(contrastRatioFromCss(thumbFocus.outlineColor, thumbFocus.background)).toBeGreaterThanOrEqual(3);
  });
});
