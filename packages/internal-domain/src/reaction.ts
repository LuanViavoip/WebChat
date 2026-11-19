import { parseEmoji, type Emoji, type MessageId } from './ids';
import type { UserId } from './identity';
import type { TenantId } from './tenant';

export type Reaction = { readonly tenantId: TenantId; readonly messageId: MessageId; readonly userId: UserId; readonly emoji: Emoji };
export type ReactionGroup = { readonly emoji: Emoji; readonly userIds: readonly UserId[] };

export function toggleReaction(current: Emoji | null, next: Emoji | null): Emoji | null {
  return current === next ? null : next;
}

export const QUICK_REACTIONS: readonly Emoji[] = ['👍', '❤️', '😂', '😮', '😢', '🙏'].map((value) => {
  const emoji = parseEmoji(value);
  if (emoji === null) throw new Error('Emoji de reação inválido.');
  return emoji;
});
