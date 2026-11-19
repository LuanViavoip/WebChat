import { readFileSync } from 'node:fs';
import path from 'node:path';
import { contrastRatio, contrastRatioFromCss, cssColorToHex, readRootVars, resolveCssColor, USED_CONTRAST_PAIRS } from './contrast';

const sourceModules: Record<string, string> = import.meta.glob(['../**/*.ts', '../**/*.tsx', '../**/*.css'], {
  eager: true,
  query: '?raw',
  import: 'default',
});

describe('contraste WCAG dos pares usados', () => {
  it.each(USED_CONTRAST_PAIRS)('$name >= $minimum', ({ foreground, background, minimum }) => {
    expect(contrastRatio(foreground, background)).toBeGreaterThanOrEqual(minimum);
  });

  it('tick de lida permanece acima de 4,5 sobre o balão enviado', () => {
    expect(contrastRatio('#1E3FCC', '#EEF2FF')).toBeGreaterThanOrEqual(4.5);
  });

  it('converte rgb computado para hex', () => {
    expect(cssColorToHex('rgb(180, 35, 24)')).toBe('#B42318');
    expect(cssColorToHex('#fff5f5')).toBe('#FFF5F5');
    expect(contrastRatioFromCss('rgb(180, 35, 24)', 'rgb(255, 245, 245)')).toBeGreaterThanOrEqual(4.5);
  });

  it('resolve tokens do :root até hex', () => {
    const vars = readRootVars(':root { --vv-ink: #0f1b3d; --text: var(--vv-ink); }');
    expect(resolveCssColor('var(--text)', vars)).toBe('#0F1B3D');
  });

  it('erro, foco e ativo nos tokens semânticos passam no mínimo', () => {
    const vars = readRootVars(`:root {
      --vv-blue-700: #1e3fcc;
      --vv-ink: #0f1b3d;
      --vv-bg: #ffffff;
      --vv-bg-soft: #f5f7ff;
      --text: var(--vv-ink);
      --surface: var(--vv-bg);
      --surface-soft: var(--vv-bg-soft);
      --focus: var(--vv-blue-700);
      --danger: #b42318;
    }`);
    expect(contrastRatio(resolveCssColor('var(--danger)', vars), '#FFF5F5')).toBeGreaterThanOrEqual(4.5);
    expect(
      contrastRatio(resolveCssColor('var(--text)', vars), resolveCssColor('var(--surface-soft)', vars)),
    ).toBeGreaterThanOrEqual(4.5);
    expect(
      contrastRatio(resolveCssColor('var(--focus)', vars), resolveCssColor('var(--surface)', vars)),
    ).toBeGreaterThanOrEqual(3);
  });

  it('chat.css real define os tokens novos da v1 com contraste resolvível', () => {
    const cssText = readFileSync(path.resolve(import.meta.dirname, 'chat.css'), 'utf8');
    const vars = readRootVars(cssText);

    const requiredV1Tokens = [
      '--alert',
      '--alert-fg',
      '--scrim',
      '--overlay-surface',
      '--quote-bar',
      '--quote-bg',
      '--reaction-bg',
      '--reaction-border',
      '--mention-fg',
      '--link-fg',
      '--poll-bar',
      '--poll-bar-track',
      '--presence-available',
      '--presence-pause',
      '--presence-away',
      '--presence-offline',
      '--pinned-bg',
      '--recording',
      '--waveform',
      '--waveform-played',
      '--debug-bg',
      '--debug-fg',
      '--debug-api',
      '--debug-ws',
      '--debug-state',
      '--debug-error',
      '--debug-action',
      '--badge-new',
    ];
    for (const token of requiredV1Tokens) {
      expect(vars[token]).toBeTruthy();
    }

    expect(
      contrastRatio(resolveCssColor('var(--alert-fg)', vars), resolveCssColor('var(--alert)', vars)),
    ).toBeGreaterThanOrEqual(4.5);
    expect(
      contrastRatio(resolveCssColor('var(--debug-fg)', vars), resolveCssColor('var(--debug-bg)', vars)),
    ).toBeGreaterThanOrEqual(4.5);
    expect(
      contrastRatio(resolveCssColor('var(--debug-error)', vars), resolveCssColor('var(--debug-bg)', vars)),
    ).toBeGreaterThanOrEqual(4.5);
    expect(
      contrastRatio(resolveCssColor('var(--presence-available)', vars), resolveCssColor('var(--vv-bg)', vars)),
    ).toBeGreaterThanOrEqual(3);
    expect(
      contrastRatio(resolveCssColor('var(--badge-new)', vars), resolveCssColor('var(--vv-bg)', vars)),
    ).toBeGreaterThanOrEqual(4.5);
  });
});

describe('cores residuais de WhatsApp / ICS', () => {
  it('não deixa tokens visuais antigos em src', () => {
    const pattern = new RegExp(
      ['d9', 'fdd3'].join('') +
        '|' +
        ['008', '069'].join('') +
        '|' +
        ['25d', '366'].join('') +
        '|' +
        ['0d86', 'b8'].join('') +
        '|' +
        ['efe', 'ae2'].join('') +
        '|' +
        ['d1d', '7db'].join(''),
      'i',
    );
    const hits = Object.entries(sourceModules)
      .filter(([, text]) => pattern.test(text))
      .map(([path]) => path);
    expect(hits).toEqual([]);
  });
});
