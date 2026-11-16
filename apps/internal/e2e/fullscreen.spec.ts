import { expect, test, type Page } from '@playwright/test';
import { enterAs, isMobileProject, USERS } from './project';

const GRAY = 'rgb(209, 215, 219)';

test.describe('tela cheia no modo página', () => {
  test('o .wa-shell preenche o viewport sem faixa cinza nem scroll horizontal', async ({ page }) => {
    const viewport = page.viewportSize();
    expect(viewport).not.toBeNull();
    if (!viewport) {
      return;
    }

    await enterAs(page, USERS.carla, { reset: true });
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
      await enterAs(page, USERS.carla, { reset: true });
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

  test('Entrar como também ocupa a tela inteira, sem faixa cinza nem scroll horizontal', async ({ page }) => {
    const viewport = page.viewportSize();
    expect(viewport).not.toBeNull();
    if (!viewport) {
      return;
    }
    await page.goto('/?reset=1');
    const screen = page.locator('.login-screen');
    await expect(screen).toBeVisible();
    const box = await screen.boundingBox();
    expect(box).not.toBeNull();
    if (!box) {
      return;
    }
    expect(Math.abs(box.width - viewport.width)).toBeLessThanOrEqual(1);
    expect(Math.abs(box.height - viewport.height)).toBeLessThanOrEqual(1);
    const overflowX = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflowX).toBeLessThanOrEqual(1);
  });

  test.describe('Administração e Equipe', () => {
    /** 100dvh sem scroll de página nem overflow horizontal; duas colunas acima de 900 px, lista OU detalhe até 900. */
    async function expectConsoleFits(page: Page, mobile: boolean, pane: 'list' | 'detail', label: string) {
      const viewport = page.viewportSize();
      expect(viewport).not.toBeNull();
      if (!viewport) {
        return;
      }
      const shell = page.locator('.admin-shell');
      await expect(shell).toBeVisible();
      const box = await shell.boundingBox();
      expect(box, label).not.toBeNull();
      if (box) {
        expect(Math.abs(box.width - viewport.width), `${label} largura`).toBeLessThanOrEqual(1);
        expect(Math.abs(box.height - viewport.height), `${label} altura (100dvh)`).toBeLessThanOrEqual(1);
        expect(Math.abs(box.x) + Math.abs(box.y), `${label} origem`).toBeLessThanOrEqual(2);
      }
      const overflow = await page.evaluate(() => ({
        x: document.documentElement.scrollWidth - window.innerWidth,
        y: document.documentElement.scrollHeight - window.innerHeight,
        bodyY: document.body.scrollHeight - window.innerHeight,
      }));
      expect(overflow.x, `${label} overflow horizontal`).toBeLessThanOrEqual(1);
      expect(overflow.y, `${label} scroll da página`).toBeLessThanOrEqual(1);
      expect(overflow.bodyY, `${label} scroll do body`).toBeLessThanOrEqual(1);

      const list = page.locator('.admin-list');
      const detail = page.locator('.admin-detail');
      if (mobile) {
        await expect(shell).toHaveAttribute('data-mobile-pane', pane === 'list' ? 'list' : 'chat');
        await (pane === 'list' ? expect(list).toBeVisible() : expect(list).toBeHidden());
        await (pane === 'list' ? expect(detail).toBeHidden() : expect(detail).toBeVisible());
        return;
      }
      await expect(list, `${label} lista`).toBeVisible();
      await expect(detail, `${label} detalhe`).toBeVisible();
      const listBox = await list.boundingBox();
      const detailBox = await detail.boundingBox();
      expect(listBox).not.toBeNull();
      expect(detailBox).not.toBeNull();
      if (listBox && detailBox) {
        expect(listBox.x + listBox.width, `${label} colunas lado a lado`).toBeLessThanOrEqual(detailBox.x + 1);
        expect(Math.abs(listBox.y - detailBox.y), `${label} colunas alinhadas`).toBeLessThanOrEqual(1);
        expect(Math.abs(listBox.height - viewport.height), `${label} lista ocupa a altura`).toBeLessThanOrEqual(1);
        expect(Math.abs(detailBox.height - viewport.height), `${label} detalhe ocupa a altura`).toBeLessThanOrEqual(1);
      }
    }

    async function back(page: Page, mobile: boolean) {
      if (mobile) {
        await page.getByRole('button', { name: 'Voltar', exact: true }).click();
      }
    }

    test('admin: lista, detalhe de usuário, formulário, ilha e registro', async ({ page }, testInfo) => {
      const mobile = isMobileProject(testInfo);
      await enterAs(page, USERS.marcos, { reset: true });
      await page.getByRole('button', { name: 'Administração' }).click();
      await expect(page.getByRole('heading', { level: 1, name: 'Administração' })).toBeVisible();
      await expectConsoleFits(page, mobile, 'list', 'admin lista');

      await page.getByRole('button', { name: /Rafael Lima/ }).click();
      await expect(page.getByRole('region', { name: /Detalhes de Rafael Lima/ })).toBeVisible();
      await expectConsoleFits(page, mobile, 'detail', 'admin detalhe de usuário');
      await back(page, mobile);

      await page.getByRole('button', { name: 'Novo supervisor' }).click();
      await expect(page.getByLabel('Nome')).toBeVisible();
      await expectConsoleFits(page, mobile, 'detail', 'admin formulário');
      await back(page, mobile);

      await page.getByRole('group', { name: 'Seções' }).getByRole('button', { name: 'Ilhas', exact: true }).click();
      await page.getByRole('button', { name: /Norte/ }).first().click();
      await expect(page.getByRole('region', { name: /Detalhes da ilha Norte/ })).toBeVisible();
      await expectConsoleFits(page, mobile, 'detail', 'admin ilha');
      await back(page, mobile);

      await page.getByRole('group', { name: 'Seções' }).getByRole('button', { name: 'Registro', exact: true }).click();
      await expect(page.getByRole('region', { name: /Registro de permissões, rolável/ })).toBeVisible();
      await expectConsoleFits(page, mobile, 'list', 'admin registro');
    });

    test('na fronteira de 900/901 px o console troca de lista/detalhe para duas colunas', async ({ page }, testInfo) => {
      test.skip(testInfo.project.name !== '1920', 'varia o viewport uma vez só');
      await page.setViewportSize({ width: 901, height: 800 });
      await enterAs(page, USERS.marcos, { reset: true });
      await page.getByRole('button', { name: 'Administração' }).click();
      await expect(page.getByRole('heading', { level: 1, name: 'Administração' })).toBeVisible();
      await expectConsoleFits(page, false, 'list', 'admin 901px');
      await page.setViewportSize({ width: 900, height: 800 });
      await expectConsoleFits(page, true, 'list', 'admin 900px');
    });

    test('supervisor: Equipe (lista e detalhe de agente)', async ({ page }, testInfo) => {
      const mobile = isMobileProject(testInfo);
      await enterAs(page, USERS.carla, { reset: true });
      await page.getByRole('button', { name: 'Equipe' }).click();
      await expect(page.getByRole('heading', { level: 1, name: 'Equipe' })).toBeVisible();
      await expectConsoleFits(page, mobile, 'list', 'equipe lista');

      await page.getByRole('button', { name: /Bruno Costa/ }).click();
      await expect(page.getByRole('region', { name: /Detalhes de Bruno Costa/ })).toBeVisible();
      await expectConsoleFits(page, mobile, 'detail', 'equipe detalhe de agente');
    });
  });
});
