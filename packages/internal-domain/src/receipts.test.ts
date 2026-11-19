import { describe, expect, it } from 'vitest';
import { asIsoInstant, asMessageId } from './ids';
import { aggregateStatus, type MessageReceipts } from './receipts';
import { uid } from './testing/domainFixtures';

const now = asIsoInstant('2026-11-19T12:00:00.000Z');

function receipts(recipients: MessageReceipts['recipients']): MessageReceipts {
  return { messageId: asMessageId('m1'), recipients };
}

describe('aggregateStatus', () => {
  it.each([
    ['erro permanece erro mesmo com todos lidos', receipts([{ userId: uid('ag-2'), deliveredAt: now, readAt: now }]), 'error' as const, 'error'],
    ['sem destinatários fica sent', receipts([]), 'sent' as const, 'sent'],
    [
      'todos leram vira read',
      receipts([
        { userId: uid('ag-2'), deliveredAt: now, readAt: now },
        { userId: uid('ag-3'), deliveredAt: now, readAt: now },
      ]),
      'sent' as const,
      'read',
    ],
    [
      'todos entregues e nenhum lido vira delivered',
      receipts([
        { userId: uid('ag-2'), deliveredAt: now, readAt: null },
        { userId: uid('ag-3'), deliveredAt: now, readAt: null },
      ]),
      'sent' as const,
      'delivered',
    ],
    [
      'readAt conta como entregue para o agregado delivered',
      receipts([
        { userId: uid('ag-2'), deliveredAt: null, readAt: now },
        { userId: uid('ag-3'), deliveredAt: now, readAt: null },
      ]),
      'sent' as const,
      'delivered',
    ],
    [
      'pendente em um destinatário permanece sent',
      receipts([
        { userId: uid('ag-2'), deliveredAt: now, readAt: null },
        { userId: uid('ag-3'), deliveredAt: null, readAt: null },
      ]),
      'sent' as const,
      'sent',
    ],
  ])('%s', (_label, value, base, expected) => {
    expect(aggregateStatus(value, base)).toBe(expected);
  });
});
