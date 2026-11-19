import type { ConversationId, ConversationSummary } from './conversation';
import type { IsoInstant } from './ids';

export type ConversationPrefs = {
  readonly pinnedAt: IsoInstant | null;
  readonly archived: boolean;
  readonly mutedUntil: IsoInstant | 'forever' | null;
};

export type ConversationPrefsRequest = {
  readonly conversationId: ConversationId;
  readonly pinned?: boolean;
  readonly archived?: boolean;
  readonly mutedUntil?: ConversationPrefs['mutedUntil'];
};

export type ListFilter = 'all' | 'unread' | 'groups' | 'pinned';

export function filterConversations(
  items: readonly ConversationSummary[],
  prefs: Readonly<Record<ConversationId, ConversationPrefs>>,
  f: ListFilter,
): readonly ConversationSummary[] {
  return items.filter((item) => {
    const pref = prefs[item.id];
    if (pref?.archived) {
      return false;
    }
    switch (f) {
      case 'all':
        return true;
      case 'unread':
        return item.unread > 0;
      case 'groups':
        return item.conversation.kind === 'group';
      case 'pinned':
        return pref?.pinnedAt !== null && pref?.pinnedAt !== undefined;
      default: {
        const exhaustive: never = f;
        return exhaustive;
      }
    }
  });
}
