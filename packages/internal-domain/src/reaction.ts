import { parseEmoji, type Emoji, type MessageId } from './ids';
import type { UserId } from './identity';
import type { TenantId } from './tenant';

export type Reaction = { readonly tenantId: TenantId; readonly messageId: MessageId; readonly userId: UserId; readonly emoji: Emoji };
export type ReactionGroup = { readonly emoji: Emoji; readonly userIds: readonly UserId[] };

export function toggleReaction(current: Emoji | null, next: Emoji | null): Emoji | null {
  return current === next ? null : next;
}

/** Uma reação por usuário por mensagem. Ordenado por contagem desc e primeiro uso. */
export function groupReactions(rs: readonly Reaction[]): readonly ReactionGroup[] {
  const byEmoji = new Map<Emoji, { readonly userIds: UserId[]; firstIndex: number }>();
  rs.forEach((reaction, index) => {
    const existing = byEmoji.get(reaction.emoji);
    if (!existing) {
      byEmoji.set(reaction.emoji, { userIds: [reaction.userId], firstIndex: index });
      return;
    }
    if (!existing.userIds.includes(reaction.userId)) {
      existing.userIds.push(reaction.userId);
    }
  });
  return [...byEmoji.entries()]
    .sort((a, b) => {
      const countDelta = b[1].userIds.length - a[1].userIds.length;
      if (countDelta !== 0) {
        return countDelta;
      }
      return a[1].firstIndex - b[1].firstIndex;
    })
    .map(([emoji, group]) => ({ emoji, userIds: group.userIds }));
}

export const QUICK_REACTIONS: readonly Emoji[] = ['👍', '❤️', '😂', '😮', '😢', '🙏'].map((value) => {
  const emoji = parseEmoji(value);
  if (emoji === null) throw new Error('Emoji de reação inválido.');
  return emoji;
});
