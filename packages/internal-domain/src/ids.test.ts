import { describe, expect, it } from 'vitest';
import { parseEmoji } from './ids';

describe('parseEmoji', () => {
  it.each(['😀', '👍🏽', '👨‍👩‍👧‍👦', '❤️'])('aceita um único grafema emoji: %s', (value) => {
    expect(parseEmoji(value)).toBe(value);
  });
  it.each(['', 'abc', '😀😀', '1', ' 👍 ', '\n'])('recusa entrada que não é um único emoji: %s', (value) => {
    expect(parseEmoji(value)).toBeNull();
  });
});
