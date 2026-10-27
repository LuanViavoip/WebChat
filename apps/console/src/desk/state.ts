import type { ConversationSummary, MessageRecord } from '@viavoip/protocol';

export type MessageBuckets = Record<string, MessageRecord[]>;
export type ReadCursors = Record<string, string | undefined>;

export function mergeMessages(current: MessageRecord[] | undefined, extra: MessageRecord[]): MessageRecord[] {
  const byId = new Map<string, MessageRecord>();
  for (const message of [...(current ?? []), ...extra]) byId.set(message.id, message);
  return [...byId.values()].sort(
    (left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id),
  );
}

export function storeMessage(buckets: MessageBuckets, message: MessageRecord): MessageBuckets {
  const existing = buckets[message.conversationId];
  return {
    ...buckets,
    [message.conversationId]: mergeMessages(existing, [message]),
  };
}

export function unreadVisitorCount(messages: MessageRecord[] | undefined, lastReadMessageId: string | undefined): number {
  const list = messages ?? [];
  const cursor = lastReadMessageId ? list.findIndex((item) => item.id === lastReadMessageId) : -1;
  const pending = cursor === -1 && lastReadMessageId ? list : cursor === -1 ? list : list.slice(cursor + 1);
  return pending.filter((item) => item.senderType === 'visitor').length;
}

export function upsertConversation(current: ConversationSummary[], next: ConversationSummary): ConversationSummary[] {
  if (next.status === 'closed') return current.filter((item) => item.id !== next.id);
  const index = current.findIndex((item) => item.id === next.id);
  if (index === -1) return [...current, next];
  const copy = current.slice();
  copy[index] = next;
  return copy;
}

export function latestMessageId(messages: MessageRecord[] | undefined): string | undefined {
  return messages?.at(-1)?.id;
}
