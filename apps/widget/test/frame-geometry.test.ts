import { describe, expect, it } from 'vitest';
import {
  effectiveOffset,
  frameGeometry,
  frameStyle,
  modeFromMessage,
  parseOffset,
  type Offsets,
} from '../src/frame-geometry.js';

const offsets: Offsets = { bottom: 16, right: 16 };

describe('frameGeometry', () => {
  it('botão: iframe de 88px com folga de 8px para sombra e foco', () => {
    expect(frameGeometry('launcher', { width: 1366, height: 768 }, offsets)).toEqual({
      mode: 'launcher',
      width: 88,
      height: 88,
      right: 8,
      bottom: 8,
      fullscreen: false,
    });
  });

  it('botão: nunca recua além da borda quando o deslocamento é pequeno', () => {
    const geometry = frameGeometry('launcher', { width: 1366, height: 768 }, { bottom: 0, right: 4 });
    expect(geometry.right).toBe(0);
    expect(geometry.bottom).toBe(0);
  });

  it('painel no desktop: 400x640 com margem de 16px', () => {
    const geometry = frameGeometry('panel', { width: 1366, height: 768 }, offsets);
    expect(geometry).toMatchObject({ width: 400, height: 640, right: 16, bottom: 16, fullscreen: false });
  });

  it('painel no desktop baixo: altura limitada a dvh - 32', () => {
    const geometry = frameGeometry('panel', { width: 1024, height: 600 }, offsets);
    expect(geometry.height).toBe(568);
  });

  it('painel logo acima de 640px ainda cabe na janela, com margens', () => {
    expect(frameGeometry('panel', { width: 641, height: 800 }, offsets).width).toBe(400);
    expect(frameGeometry('panel', { width: 700, height: 800 }, { bottom: 16, right: 300 }).width).toBe(384);
  });

  it('painel até 640px: tela cheia', () => {
    const geometry = frameGeometry('panel', { width: 390, height: 844 }, offsets);
    expect(geometry).toMatchObject({ width: 390, height: 844, right: 0, bottom: 0, fullscreen: true });
    expect(frameGeometry('panel', { width: 640, height: 900 }, offsets).fullscreen).toBe(true);
  });

  it('respeita deslocamento maior (banner de cookies) sem estourar o viewport', () => {
    const geometry = frameGeometry('panel', { width: 1366, height: 768 }, { bottom: 96, right: 16 });
    expect(geometry.bottom).toBe(96);
    expect(geometry.height).toBe(640);
    const low = frameGeometry('panel', { width: 1366, height: 600 }, { bottom: 96, right: 16 });
    expect(low.height).toBe(488);
    expect(low.bottom + low.height).toBeLessThanOrEqual(600 - 16);
  });

  it('nunca devolve painel menor que o mínimo utilizável', () => {
    expect(frameGeometry('panel', { width: 800, height: 250 }, { bottom: 200, right: 16 }).height).toBe(200);
  });
});

describe('frameStyle', () => {
  it('tela cheia usa unidades do viewport do site', () => {
    const style = frameStyle(frameGeometry('panel', { width: 390, height: 844 }, offsets));
    expect(style).toMatchObject({ top: '0', left: '0', right: '0', bottom: '0', width: '100vw', height: '100dvh', 'border-radius': '0' });
  });

  it('painel desktop tem raio e sombra; botão não', () => {
    const panel = frameStyle(frameGeometry('panel', { width: 1366, height: 768 }, offsets));
    expect(panel).toMatchObject({ width: '400px', height: '640px', right: '16px', bottom: '16px', 'border-radius': '16px' });
    expect(panel['box-shadow']).not.toBe('none');
    const launcher = frameStyle(frameGeometry('launcher', { width: 1366, height: 768 }, offsets));
    expect(launcher).toMatchObject({ width: '88px', height: '88px', 'border-radius': '0', 'box-shadow': 'none' });
  });
});

describe('parseOffset', () => {
  it('aceita px, rem e número puro', () => {
    expect(parseOffset('80px', 0)).toBe(80);
    expect(parseOffset(' 5rem ', 0)).toBe(80);
    expect(parseOffset('24', 0)).toBe(24);
  });

  it('usa o padrão para ausente, vazio, inválido ou negativo', () => {
    expect(parseOffset(undefined, 16)).toBe(16);
    expect(parseOffset('', 16)).toBe(16);
    expect(parseOffset('calc(1px)', 16)).toBe(16);
    expect(parseOffset('-4px', 16)).toBe(16);
  });

  it('soma o que o site reserva ao deslocamento base', () => {
    expect(effectiveOffset(16, 0, 0)).toBe(16);
    expect(effectiveOffset(16, 72, 8)).toBe(96);
  });
});

describe('modeFromMessage', () => {
  it('open e close definem o modo', () => {
    expect(modeFromMessage({ type: 'open' }, 'launcher', false)).toEqual({ mode: 'panel', sawModeEvent: true });
    expect(modeFromMessage({ type: 'close' }, 'panel', true)).toEqual({ mode: 'launcher', sawModeEvent: true });
  });

  it('resize legado só vale enquanto não houve open/close', () => {
    expect(modeFromMessage({ type: 'resize', width: 380, height: 640 }, 'launcher', false).mode).toBe('panel');
    expect(modeFromMessage({ type: 'resize', width: 72, height: 72 }, 'panel', false).mode).toBe('launcher');
    expect(modeFromMessage({ type: 'resize', width: 400, height: 640 }, 'launcher', true).mode).toBe('launcher');
  });

  it('ignora mensagens sem efeito', () => {
    expect(modeFromMessage({ type: 'ready' }, 'panel', true)).toEqual({ mode: 'panel', sawModeEvent: true });
    expect(modeFromMessage({ type: 'resize', width: Number.NaN, height: 10 }, 'launcher', false).mode).toBe('launcher');
  });
});
