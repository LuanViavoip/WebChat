import { describe, expect, it } from 'vitest';
import {
  MAX_POLL_OPTIONS,
  MAX_POLL_OPTION_LENGTH,
  MAX_POLL_QUESTION_LENGTH,
  validatePoll,
} from './poll';
import { err, ok } from './result';

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
