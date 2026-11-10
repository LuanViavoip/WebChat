import { insertAtCursor } from './textCursor';

describe('insertAtCursor', () => {
  it('insere no meio e avança o cursor', () => {
    expect(insertAtCursor('ola', '💚', 2, 2)).toEqual({ text: 'ol💚a', caret: 4 });
  });

  it('substitui a seleção', () => {
    expect(insertAtCursor('ola', 'x', 1, 3)).toEqual({ text: 'ox', caret: 2 });
  });
});
