import { insertAtCursor } from './textCursor';

describe('insertAtCursor', () => {
  it('insere no meio e avança o cursor', () => {
    expect(insertAtCursor('ola', '💚', 2, 2)).toEqual({ text: 'ol💚a', caret: 4 });
  });

  it('substitui a seleção', () => {
    expect(insertAtCursor('ola', 'x', 1, 3)).toEqual({ text: 'ox', caret: 2 });
  });

  it('substitui a seleção por emoji', () => {
    expect(insertAtCursor('hello', '💚', 1, 4)).toEqual({ text: 'h💚o', caret: 3 });
  });

  it('trata emoji composto (ZWJ / surrogate pairs) como um único insert', () => {
    const emoji = '👩‍⚕️';
    const result = insertAtCursor('ab', emoji, 1, 1);
    expect(result.text).toBe(`a${emoji}b`);
    expect(result.caret).toBe(1 + emoji.length);
  });
});
