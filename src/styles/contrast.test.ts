import { contrastRatio, USED_CONTRAST_PAIRS } from './contrast';

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
