import { describe, expect, it } from 'vitest';
import { parseEmoji } from './ids';
import { QUICK_REACTIONS, toggleReaction } from './reaction';

describe('toggleReaction', () => {
  const like = parseEmoji('👍');
  const heart = parseEmoji('❤️');

  it.each([
    ['adiciona reação quando não há atual', null, like, like],
    ['troca reação por outro emoji', like, heart, heart],
    ['remove reação ao repetir o mesmo emoji', like, like, null],
    ['remove reação ao passar null', like, null, null],
    ['permanece null quando atual e próximo são null', null, null, null],
  ])('%s', (_label, current, next, expected) => {
    expect(toggleReaction(current, next)).toBe(expected);
  });

  it('expõe 6 reações rápidas válidas', () => {
    expect(QUICK_REACTIONS).toHaveLength(6);
  });
});
