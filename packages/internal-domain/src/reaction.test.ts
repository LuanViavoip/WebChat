import { describe, expect, it } from 'vitest';
import { asMessageId, parseEmoji } from './ids';
import { T1, uid } from './testing/domainFixtures';
import { groupReactions, QUICK_REACTIONS, toggleReaction } from './reaction';

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

describe('groupReactions', () => {
  it('agrupa por emoji, ordena por contagem e preserva o primeiro uso em empate', () => {
    const like = parseEmoji('👍');
    const heart = parseEmoji('❤️');
    const wow = parseEmoji('😮');
    if (!like || !heart || !wow) {
      throw new Error('emoji inválido no fixture');
    }
    const grouped = groupReactions([
      { tenantId: T1, messageId: asMessageId('m1'), userId: uid('ag-1'), emoji: like },
      { tenantId: T1, messageId: asMessageId('m1'), userId: uid('ag-2'), emoji: heart },
      { tenantId: T1, messageId: asMessageId('m1'), userId: uid('ag-3'), emoji: like },
      { tenantId: T1, messageId: asMessageId('m1'), userId: uid('ag-1'), emoji: like },
      { tenantId: T1, messageId: asMessageId('m1'), userId: uid('ag-4'), emoji: wow },
    ]);
    expect(grouped.map((group) => [group.emoji, [...group.userIds]])).toEqual([
      [like, [uid('ag-1'), uid('ag-3')]],
      [heart, [uid('ag-2')]],
      [wow, [uid('ag-4')]],
    ]);
  });
});
