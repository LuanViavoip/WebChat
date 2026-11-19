import { describe, expect, it } from 'vitest';
import { asConversationId } from './conversation';
import { asClientId, asIsoInstant } from './ids';
import { err, ok } from './result';
import {
  MAX_SCHEDULE_AHEAD_MS,
  MAX_SCHEDULE_TEXT_LENGTH,
  type ScheduleRequest,
  validateSchedule,
} from './schedule';

const NOW = asIsoInstant('2026-11-19T12:00:00.000Z');
const CID = asConversationId('dm:empresa-1:ag-1:ag-2');

function after(ms: number): ReturnType<typeof asIsoInstant> {
  return asIsoInstant(new Date(Date.parse(NOW) + ms).toISOString());
}

describe('validateSchedule', () => {
  it.each<[string, ScheduleRequest, ReturnType<typeof validateSchedule>]>([
    [
      'aceita mensagem agendada dentro de 30 dias',
      {
        kind: 'message',
        clientId: asClientId('c1'),
        conversationId: CID,
        text: 'Bom dia!',
        sendAt: after(60_000),
      },
      ok(true),
    ],
    [
      'aceita lembrete exatamente no limite de 30 dias',
      {
        kind: 'reminder',
        clientId: asClientId('c2'),
        note: 'Retornar cliente',
        at: after(MAX_SCHEDULE_AHEAD_MS),
      },
      ok(true),
    ],
    [
      'recusa texto vazio',
      {
        kind: 'message',
        clientId: asClientId('c3'),
        conversationId: CID,
        text: '   ',
        sendAt: after(60_000),
      },
      err('empty'),
    ],
    [
      'recusa nota acima de 4000 caracteres',
      {
        kind: 'reminder',
        clientId: asClientId('c4'),
        note: 'a'.repeat(MAX_SCHEDULE_TEXT_LENGTH + 1),
        at: after(60_000),
      },
      err('too-long'),
    ],
    [
      'recusa horário igual ao atual',
      {
        kind: 'message',
        clientId: asClientId('c5'),
        conversationId: CID,
        text: 'Oi',
        sendAt: NOW,
      },
      err('in-past'),
    ],
    [
      'recusa horário no passado',
      {
        kind: 'reminder',
        clientId: asClientId('c6'),
        note: 'Lembrete',
        at: after(-1000),
      },
      err('in-past'),
    ],
    [
      'recusa horário além de 30 dias',
      {
        kind: 'message',
        clientId: asClientId('c7'),
        conversationId: CID,
        text: 'Oi',
        sendAt: after(MAX_SCHEDULE_AHEAD_MS + 1),
      },
      err('too-far'),
    ],
  ])('%s', (_label, request, expected) => {
    expect(validateSchedule(request, NOW)).toEqual(expected);
  });
});
