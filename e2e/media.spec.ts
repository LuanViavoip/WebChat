import { expect, test, type Page } from '@playwright/test';
import { audioFile, exeFile, oversizedPng, pdfFile, pngFile, videoFile } from './files';
import { chatFileInput, DESKTOP_PROJECTS, isMobileProject, openLiveChat } from './project';

async function attach(page: Page, file: { name: string; mimeType: string; buffer: Buffer }) {
  await chatFileInput(page).setInputFiles(file);
}

async function noHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => {
    const shell = document.querySelector('.wa-shell');
    const list = document.querySelector('.message-list');
    const shellOverflow = shell ? shell.scrollWidth - shell.clientWidth : 0;
    const listOverflow = list ? list.scrollWidth - list.clientWidth : 0;
    return Math.max(shellOverflow, listOverflow);
  });
  expect(overflow).toBeLessThanOrEqual(1);
}

test.describe('mídia', () => {
  test('envia imagem com legenda', async ({ page }, testInfo) => {
    await openLiveChat(page, testInfo);
    await page.getByRole('button', { name: 'Anexar arquivo' }).click();
    await attach(page, pngFile());
    const caption = page.getByLabel('Legenda');
    await expect(caption).toBeFocused();
    await caption.fill('minha foto');
    await page.getByRole('button', { name: 'Enviar' }).click();
    await expect(page.getByRole('img', { name: 'minha foto' })).toBeVisible();
    await expect(page.locator('.message-list').getByText('minha foto')).toBeVisible();
    await expect(page.getByLabel('Lida')).toBeVisible();
    await noHorizontalScroll(page);
  });

  test('visualizador abre e fecha com Esc devolvendo o foco', async ({ page }, testInfo) => {
    await openLiveChat(page, testInfo);
    await attach(page, pngFile());
    await page.getByRole('button', { name: 'Enviar' }).click();
    const thumb = page.getByRole('button', { name: 'Abrir foto em tela cheia' });
    await expect(thumb).toBeVisible();
    await thumb.click();
    const dialog = page.getByRole('dialog', { name: 'Foto em tela cheia' });
    await expect(dialog).toBeVisible();
    const box = await dialog.boundingBox();
    const viewport = page.viewportSize();
    expect(box).not.toBeNull();
    expect(viewport).not.toBeNull();
    if (box && viewport) {
      expect(box.width).toBeGreaterThan(viewport.width * 0.5);
      expect(box.height).toBeGreaterThan(viewport.height * 0.5);
    }
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(thumb).toBeFocused();
  });

  test('documento com download', async ({ page }, testInfo) => {
    test.skip(
      testInfo.project.name !== '1920' && !isMobileProject(testInfo),
      'documento em 1920 e 390',
    );
    await openLiveChat(page, testInfo);
    await attach(page, pdfFile());
    await page.getByRole('button', { name: 'Enviar' }).click();
    await expect(page.locator('.message-list').getByText('guia.pdf')).toBeVisible();
    await expect(page.getByText(/PDF ·/)).toBeVisible();
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('link', { name: /Baixar guia.pdf/ }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe('guia.pdf');
  });

  test('áudio e vídeo nativos', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== '1366', 'players em 1366');
    await openLiveChat(page, testInfo);
    await attach(page, audioFile());
    await page.getByRole('button', { name: 'Enviar' }).click();
    await expect(page.locator('audio[controls]')).toBeVisible();
    await attach(page, videoFile());
    await page.getByRole('button', { name: 'Enviar' }).click();
    await expect(page.locator('video[controls]')).toBeVisible();
  });

  test('validação de tipo, tamanho e múltiplos', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== '1366', 'validação em 1366');
    await openLiveChat(page, testInfo);
    await attach(page, exeFile());
    await expect(page.getByRole('alert').locator('p')).toHaveText(
      /Formato não suportado: virus.exe\. Envie foto \(JPG, PNG\), vídeo \(MP4, 3GP\), áudio \(MP3, M4A, AAC, AMR, OGG\) ou documento \(PDF, DOC, DOCX, XLS, XLSX, PPT, PPTX, TXT\)\./,
    );
    await page.getByRole('button', { name: 'Fechar' }).click();
    await attach(page, oversizedPng());
    await expect(page.getByRole('alert').locator('p')).toHaveText(/grande.png tem .+\. O limite para foto é 5 MB\./);
    await page.getByRole('button', { name: 'Fechar' }).click();
    await page.locator('.wa-chat').evaluate((node) => {
      const transfer = new DataTransfer();
      transfer.items.add(new File([new Uint8Array([1, 2, 3])], 'a.png', { type: 'image/png' }));
      transfer.items.add(new File([new Uint8Array([1, 2, 3])], 'b.png', { type: 'image/png' }));
      node.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer }));
    });
    await expect(page.getByRole('alert').locator('p')).toHaveText('Envie um arquivo por vez.');
  });

  test('falha de upload e tentar de novo', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== '1920', 'falha em 1920');
    await openLiveChat(page, testInfo, 'falha=upload');
    await attach(page, pngFile('exame.png'));
    await page.getByRole('button', { name: 'Enviar' }).click();
    await expect(page.getByRole('alert')).toHaveText(/Falha ao enviar exame.png\./);
    await page.getByRole('button', { name: 'Tentar enviar exame.png de novo' }).click();
    await expect(page.getByLabel('Lida')).toBeVisible({ timeout: 15_000 });
  });

  test('cancelar upload lento remove a bolha', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== '1920', 'cancelar em 1920');
    await openLiveChat(page, testInfo, 'upload=lento');
    await attach(page, pngFile('exame.png'));
    await page.getByRole('button', { name: 'Enviar' }).click();
    await expect(page.getByRole('progressbar')).toBeVisible();
    await page.getByRole('button', { name: 'Cancelar envio de exame.png' }).click();
    await expect(page.getByRole('progressbar')).toHaveCount(0);
    await expect(page.getByLabel(/Você: Foto/)).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Conversa de teste/ })).not.toHaveText(/Enviando/);
  });

  test('a imagem do preview carrega de fato, não só aparece', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== '1920', 'cenário em 1920');
    await openLiveChat(page, testInfo);
    await attach(page, pngFile('exame.png'));
    const img = page.getByRole('img', { name: 'Pré-visualização de exame.png' });
    await expect(img).toBeVisible();
    await expect.poll(() => img.evaluate((node: HTMLImageElement) => node.complete)).toBe(true);
    expect(await img.evaluate((node: HTMLImageElement) => node.naturalWidth)).toBeGreaterThan(0);
  });

  test('depois de Enviar no preview o foco vai para Anexar arquivo', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== '1920', 'cenário em 1920');
    await openLiveChat(page, testInfo);
    await attach(page, pngFile('exame.png'));
    await page.getByLabel('Legenda').press('Enter');
    await expect(page.getByRole('button', { name: 'Abrir foto em tela cheia' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Anexar arquivo' })).toBeFocused();
  });

  test('soltar arquivo fora da área de drop não deixa o navegador abrir o arquivo', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== '1920', 'cenário em 1920');
    await openLiveChat(page, testInfo);
    const prevented = await page.locator('.wa-sidebar').evaluate((node) => {
      const transfer = new DataTransfer();
      transfer.items.add(new File([new Uint8Array([1])], 'foto.png', { type: 'image/png' }));
      const over = new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: transfer });
      const drop = new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer });
      node.dispatchEvent(over);
      node.dispatchEvent(drop);
      return { over: over.defaultPrevented, drop: drop.defaultPrevented };
    });
    expect(prevented).toEqual({ over: true, drop: true });
  });

  test('arrastar e soltar abre o preview', async ({ page }, testInfo) => {
    test.skip(!(DESKTOP_PROJECTS as readonly string[]).includes(testInfo.project.name), 'drop no desktop');
    await openLiveChat(page, testInfo);
    const overlay = page.locator('.drop-overlay');
    const bytes = [...pngFile().buffer];
    await page.locator('.wa-chat').evaluate((node, payload) => {
      const transfer = new DataTransfer();
      transfer.items.add(new File([new Uint8Array(payload)], 'foto.png', { type: 'image/png' }));
      node.dispatchEvent(new DragEvent('dragenter', { bubbles: true, cancelable: true, dataTransfer: transfer }));
    }, bytes);
    await expect(overlay).toBeVisible();
    await page.locator('.wa-chat').evaluate((node, payload) => {
      const transfer = new DataTransfer();
      transfer.items.add(new File([new Uint8Array(payload)], 'foto.png', { type: 'image/png' }));
      node.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: transfer }));
      node.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer }));
    }, bytes);
    await expect(page.getByRole('region', { name: 'Pré-visualização do anexo' })).toBeVisible();
  });

  test('layout permanece tela cheia com preview e bolha', async ({ page }, testInfo) => {
    await openLiveChat(page, testInfo);
    await attach(page, pngFile());
    const viewport = page.viewportSize();
    const box = await page.locator('.wa-shell').boundingBox();
    expect(viewport).not.toBeNull();
    expect(box).not.toBeNull();
    if (box && viewport) {
      expect(Math.abs(box.width - viewport.width)).toBeLessThanOrEqual(1);
      expect(Math.abs(box.height - viewport.height)).toBeLessThanOrEqual(1);
    }
    await page.getByRole('button', { name: 'Enviar' }).click();
    await expect(page.getByRole('button', { name: 'Abrir foto em tela cheia' })).toBeVisible();
  });
});
