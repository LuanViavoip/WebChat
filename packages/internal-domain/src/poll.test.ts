import { describe, expect, it } from 'vitest';
import { asConversationId } from './conversation';
import { asIsoInstant, asMessageId, asPollOptionId } from './ids';
import type { PollMessage } from './message';
import {
  applyVote,
  MAX_POLL_OPTIONS,
  MAX_POLL_OPTION_LENGTH,
  MAX_POLL_QUESTION_LENGTH,
  type PollTally,
  validatePoll,
} from './poll';
import { err, ok } from './result';
import { T1, uid } from './testing/domainFixtures';

describe('validatePoll', () => {
  it.each<
    [
      string,
      { question: string; options: readonly string[]; multiple: boolean },
      ReturnType<typeof validatePoll>,
    ]
  >([
    [
      'aceita enquete válida e remove espaços extras',
      { question: '  Almoço hoje?  ', options: [' Sim ', ' Não ', ''], multiple: false },
      ok({ question: 'Almoço hoje?', options: ['Sim', 'Não'], multiple: false }),
    ],
    [
      'aceita exatamente 12 opções',
      {
        question: 'Horário',
        options: Array.from({ length: MAX_POLL_OPTIONS }, (_, index) => `Opção ${String(index + 1)}`),
        multiple: true,
      },
      ok({
        question: 'Horário',
        options: [
          'Opção 1',
          'Opção 2',
          'Opção 3',
          'Opção 4',
          'Opção 5',
          'Opção 6',
          'Opção 7',
          'Opção 8',
          'Opção 9',
          'Opção 10',
          'Opção 11',
          'Opção 12',
        ],
        multiple: true,
      }),
    ],
    ['recusa pergunta vazia', { question: '   ', options: ['A', 'B'], multiple: false }, err('empty-question')],
    [
      'recusa pergunta maior que 200 caracteres',
      { question: 'x'.repeat(MAX_POLL_QUESTION_LENGTH + 1), options: ['A', 'B'], multiple: false },
      err('too-long'),
    ],
    ['recusa menos de 2 opções', { question: 'Pergunta?', options: ['A', '   '], multiple: false }, err('too-few-options')],
    [
      'recusa mais de 12 opções',
      {
        question: 'Pergunta?',
        options: Array.from({ length: MAX_POLL_OPTIONS + 1 }, (_, index) => `Opção ${String(index + 1)}`),
        multiple: false,
      },
      err('too-many-options'),
    ],
    [
      'recusa opção maior que 80 caracteres',
      { question: 'Pergunta?', options: ['A', 'y'.repeat(MAX_POLL_OPTION_LENGTH + 1)], multiple: false },
      err('too-long'),
    ],
    [
      'recusa opção duplicada ignorando maiúsculas/minúsculas',
      { question: 'Pergunta?', options: ['Sim', 'sim'], multiple: false },
      err('duplicate-option'),
    ],
  ])('%s', (_label, input, expected) => {
    expect(validatePoll(input)).toEqual(expected);
  });
});

const A = asPollOptionId('a');
const B = asPollOptionId('b');
const C = asPollOptionId('c');

const poll: PollMessage = {
  id: asMessageId('poll-1'),
  tenantId: T1,
  conversationId: asConversationId('grp:empresa-1:1'),
  authorId: uid('ag-1'),
  author: { id: uid('ag-1'), name: 'Agente 1' },
  timestamp: asIsoInstant('2026-11-19T12:00:00.000Z'),
  status: 'sent',
  type: 'poll',
  question: 'Almoço?',
  options: [
    { id: A, text: 'Sim' },
    { id: B, text: 'Não' },
    { id: C, text: 'Talvez' },
  ],
  multiple: false,
  closedAt: null,
};

const emptyTally: PollTally = {
  totals: { [A]: 0, [B]: 0, [C]: 0 },
  voters: { [A]: [], [B]: [], [C]: [] },
  closed: false,
};

describe('applyVote', () => {
  it('registra voto simples e troca a opção do mesmo usuário', () => {
    const first = applyVote(emptyTally, uid('ag-2'), [A], poll);
    expect(first).toEqual(
      ok({
        totals: { [A]: 1, [B]: 0, [C]: 0 },
        voters: { [A]: [uid('ag-2')], [B]: [], [C]: [] },
        closed: false,
      }),
    );
    if (!first.ok) {
      throw new Error('esperado voto aceito');
    }
    expect(applyVote(first.value, uid('ag-2'), [B], poll)).toEqual(
      ok({
        totals: { [A]: 0, [B]: 1, [C]: 0 },
        voters: { [A]: [], [B]: [uid('ag-2')], [C]: [] },
        closed: false,
      }),
    );
  });

  it('lista vazia retira o voto', () => {
    const voted = applyVote(emptyTally, uid('ag-2'), [A], poll);
    if (!voted.ok) {
      throw new Error('esperado voto aceito');
    }
    expect(applyVote(voted.value, uid('ag-2'), [], poll)).toEqual(ok(emptyTally));
  });

  it('recusa múltiplas opções quando a enquete é de escolha única', () => {
    expect(applyVote(emptyTally, uid('ag-2'), [A, B], poll)).toEqual(err('multiple-not-allowed'));
  });

  it('aceita múltiplas opções quando permitido', () => {
    expect(applyVote(emptyTally, uid('ag-2'), [A, C], { ...poll, multiple: true })).toEqual(
      ok({
        totals: { [A]: 1, [B]: 0, [C]: 1 },
        voters: { [A]: [uid('ag-2')], [B]: [], [C]: [uid('ag-2')] },
        closed: false,
      }),
    );
  });

  it('recusa opção desconhecida e enquete encerrada', () => {
    expect(applyVote(emptyTally, uid('ag-2'), [asPollOptionId('z')], poll)).toEqual(err('unknown-option'));
    expect(applyVote({ ...emptyTally, closed: true }, uid('ag-2'), [A], poll)).toEqual(err('closed'));
    expect(
      applyVote(emptyTally, uid('ag-2'), [A], { ...poll, closedAt: asIsoInstant('2026-11-19T12:01:00.000Z') }),
    ).toEqual(err('closed'));
  });
});
