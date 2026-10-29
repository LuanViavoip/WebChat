import { describe, expect, it } from 'vitest';
import { panelSize } from '../src/panel-size.js';

describe('tamanho nominal do painel do widget', () => {
  it('informa botão de 88px e painel de 400x640, sem depender do tamanho do próprio iframe', () => {
    expect(panelSize(false)).toEqual({ width: 88, height: 88 });
    expect(panelSize(true)).toEqual({ width: 400, height: 640 });
  });

  it('cabe no schema estrito de resize do protocolo (64..480 x 64..720)', () => {
    for (const open of [true, false]) {
      const { width, height } = panelSize(open);
      expect(width).toBeGreaterThanOrEqual(64);
      expect(width).toBeLessThanOrEqual(480);
      expect(height).toBeGreaterThanOrEqual(64);
      expect(height).toBeLessThanOrEqual(720);
    }
  });
});
