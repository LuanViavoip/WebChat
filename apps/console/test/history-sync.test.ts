import type { InternalMessage } from '@viavoip/protocol';
import { describe, expect, it, vi } from 'vitest';
import { recoverAndCommitInternalHistory } from '../src/internal/history-sync.js';

describe('sincronização do chat interno', () => {
  it('só avança cursor e mensagens quando todas as páginas são recuperadas', async () => {
    const cursor = 'anchor';
    const committed: { cursor: string; messages: InternalMessage[] } = { cursor, messages: [] };
    let calls = 0;
    const commit = vi.fn((recovery: { cursor: string | undefined; messages: InternalMessage[] }) => {
      committed.cursor = recovery.cursor ?? committed.cursor;
      committed.messages = recovery.messages;
    });

    await expect(recoverAndCommitInternalHistory(cursor, async (after) => {
      calls += 1;
      if (calls === 1) return Array.from({ length: 100 }, (_, index) => message(index));
      expect(after).toBe(message(99).id);
      throw new Error('socket desconectado na segunda página');
    }, commit)).rejects.toThrow('socket desconectado na segunda página');

    expect(commit).not.toHaveBeenCalled();
    expect(committed).toEqual({ cursor, messages: [] });
  });

  it('confirma as três páginas em ordem quando a recuperação termina', async () => {
    const cursor = 'anchor';
    const all = Array.from({ length: 205 }, (_, index) => message(index));
    const committed: InternalMessage[] = [];
    let committedCursor = cursor;
    const recovery = await recoverAndCommitInternalHistory(cursor, async (after) => {
      const start = after === cursor ? 0 : all.findIndex((item) => item.id === after) + 1;
      return all.slice(start, start + 100);
    }, (result) => {
      committed.push(...result.messages);
      committedCursor = result.cursor ?? committedCursor;
    });

    expect(committed).toHaveLength(205);
    expect(committed.map((item) => item.id)).toEqual(all.map((item) => item.id));
    expect(committedCursor).toBe(message(204).id);
    expect(recovery.messages).toHaveLength(205);
  });
});

function message(index: number): InternalMessage {
  const suffix = index.toString(16).padStart(12, '0');
  return {
    id: `aaaaaaaa-1111-4111-8111-${suffix}`,
    conversationId: 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbb1',
    senderId: 'cccccccc-3333-4333-8333-ccccccccccc1',
    senderName: 'Operador',
    requestId: `dddddddd-4444-4444-8444-${suffix}`,
    body: `mensagem ${index}`,
    createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString(),
  };
}
