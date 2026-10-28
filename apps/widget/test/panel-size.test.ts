import { describe, expect, it } from 'vitest';
import { panelSize } from '../src/panel-size.js';

describe('tamanho do painel do widget', () => {
  it('pede o painel de atendimento mesmo quando o iframe ainda está no botão de 72px', () => {
    expect(panelSize(true)).toEqual({ width: 380, height: 640 });
    expect(panelSize(false)).toEqual({ width: 72, height: 72 });
  });
});
