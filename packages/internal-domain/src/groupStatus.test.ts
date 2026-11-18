import { describe, expect, it } from 'vitest';
import { groupMessageRead } from './groupStatus';
import { uid } from './testing/domainFixtures';

describe('leitura agregada de grupo', () => {
  const author = uid('author');
  const a = uid('a');
  const b = uid('b');
  const messages = [{ id: 'one' }, { id: 'two' }, { id: 'three' }];
  it('aguarda todos os demais membros alcançarem a mensagem', () => {
    expect(groupMessageRead([author, a, b], author, 'two', messages, { [a]: 'three', [b]: 'one' })).toBe(false);
    expect(groupMessageRead([author, a, b], author, 'two', messages, { [a]: 'three', [b]: 'two' })).toBe(true);
    expect(groupMessageRead([author, a, b], author, 'two', messages, { [a]: 'three' })).toBe(false);
  });
  it('recusa cursores ou mensagem desconhecidos', () => {
    expect(groupMessageRead([author, a], author, 'missing', messages, { [a]: 'three' })).toBe(false);
    expect(groupMessageRead([author, a], author, 'one', messages, { [a]: 'missing' })).toBe(false);
  });
});

