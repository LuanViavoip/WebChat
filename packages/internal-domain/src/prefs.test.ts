import { describe, expect, it } from 'vitest';
import { asConversationId, type ConversationSummary, type DirectPair } from './conversation';
import { asIsoInstant } from './ids';
import { filterConversations, type ConversationPrefs } from './prefs';
import { T1, uid } from './testing/domainFixtures';

function summary(
  id: string,
  kind: 'direct' | 'group',
  unread: number,
): ConversationSummary {
  const conversationId = asConversationId(id);
  if (kind === 'group') {
    return {
      id: conversationId,
      conversation: {
        kind: 'group',
        id: conversationId,
        tenantId: T1,
        title: id,
        origin: { kind: 'custom', createdBy: uid('ag-1') },
        members: [uid('ag-1'), uid('ag-2')],
        formerMemberIds: [],
        createdAt: '2026-11-19T12:00:00.000Z',
      },
      lastActivityAt: '2026-11-19T12:00:00.000Z',
      unread,
    };
  }
  return {
    id: conversationId,
    conversation: {
      kind: 'direct',
      id: conversationId,
      tenantId: T1,
      participants: [uid('ag-1'), uid('ag-2')] as unknown as DirectPair,
    },
    lastActivityAt: '2026-11-19T12:00:00.000Z',
    unread,
  };
}

describe('filterConversations', () => {
  const unreadDirect = summary('dm-1', 'direct', 2);
  const readDirect = summary('dm-2', 'direct', 0);
  const groupItem = summary('grp-1', 'group', 1);
  const archived = summary('dm-3', 'direct', 4);
  const prefs: Readonly<Record<string, ConversationPrefs>> = {
    [unreadDirect.id]: { pinnedAt: asIsoInstant('2026-11-19T12:00:00.000Z'), archived: false, mutedUntil: null },
    [readDirect.id]: { pinnedAt: null, archived: false, mutedUntil: null },
    [groupItem.id]: { pinnedAt: null, archived: false, mutedUntil: null },
    [archived.id]: { pinnedAt: null, archived: true, mutedUntil: null },
  };

  const items = [unreadDirect, readDirect, groupItem, archived];

  it.each([
    ['all omite arquivadas', 'all' as const, [unreadDirect.id, readDirect.id, groupItem.id]],
    ['unread só com não lidas ativas', 'unread' as const, [unreadDirect.id, groupItem.id]],
    ['groups só grupos', 'groups' as const, [groupItem.id]],
    ['pinned só fixadas', 'pinned' as const, [unreadDirect.id]],
  ])('%s', (_label, filter, expectedIds) => {
    expect(filterConversations(items, prefs, filter).map((item) => item.id)).toEqual(expectedIds);
  });
});
