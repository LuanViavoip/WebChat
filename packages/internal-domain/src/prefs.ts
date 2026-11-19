import type { ConversationId } from './conversation';
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
