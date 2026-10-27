import { describe, expect, it } from 'vitest';
import type { MessageRecord } from '@viavoip/protocol';
import { storeMessage, unreadVisitorCount } from '../src/desk/state.js';

const first: MessageRecord = {
  id: 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaa1',
  conversationId: 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbb1',
  senderType: 'visitor',
  senderId: 'cccccccc-3333-4333-8333-ccccccccccc1',
  requestId: 'dddddddd-4444-4444-8444-ddddddddddd1',
  body: 'fila',
  createdAt: '2026-10-27T12:00:00.000Z',
};

const second: MessageRecord = {
  ...first,
  id: 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaa2',
  conversationId: 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbb2',
  requestId: 'dddddddd-4444-4444-8444-ddddddddddd2',
  body: 'outra',
  createdAt: '2026-10-27T12:00:01.000Z',
};

describe('estado da central', () => {
  it('guarda a mensagem na conversa de origem e conta a não lida fora da seleção', () => {
    const stored = storeMessage(storeMessage({}, first), second);
    expect(stored[first.conversationId]?.map((item) => item.body)).toEqual(['fila']);
    expect(stored[second.conversationId]?.map((item) => item.body)).toEqual(['outra']);
    expect(unreadVisitorCount(stored[second.conversationId], undefined)).toBe(1);
    expect(unreadVisitorCount(stored[second.conversationId], second.id)).toBe(0);
  });
});
