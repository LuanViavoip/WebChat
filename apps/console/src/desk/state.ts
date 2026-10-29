import type { ConversationSummary, MessageRecord } from '@viavoip/protocol';

export type MessageBuckets = Record<string, MessageRecord[]>;
export type ReadCursors = Record<string, string | undefined>;

/** União por id, ordenada por data e id. Serve às mensagens da central e do chat interno. */
export function mergeMessages<T extends { id: string; createdAt: string }>(current: T[] | undefined, extra: T[]): T[] {
  const byId = new Map<string, T>();
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

export function upsertConversation(current: ConversationSummary[], next: ConversationSummary, keepClosed = false): ConversationSummary[] {
  if (next.status === 'closed' && !keepClosed) return current.filter((item) => item.id !== next.id);
  const index = current.findIndex((item) => item.id === next.id);
  if (index === -1) return [...current, next];
  const copy = current.slice();
  copy[index] = next;
  return copy;
}

export function latestMessageId(messages: MessageRecord[] | undefined): string | undefined {
  return messages?.at(-1)?.id;
}

export type MessagePreview = { text: string; senderType: MessageRecord['senderType']; createdAt: string };

/** Prévia da última mensagem já carregada (sem endpoint novo). Quebras de linha viram espaço. */
export function lastMessagePreview(messages: MessageRecord[] | undefined): MessagePreview | null {
  const last = messages?.at(-1);
  if (!last) return null;
  return { text: last.body.replace(/\s+/g, ' ').trim(), senderType: last.senderType, createdAt: last.createdAt };
}

export type DayGroup<T extends { createdAt: string }> = { key: string; label: string; messages: T[] };

export function dayKey(value: Date | string | number): string {
  const date = value instanceof Date ? value : new Date(value);
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${String(date.getFullYear())}-${month}-${day}`;
}

const longDate = new Intl.DateTimeFormat('pt-BR', { day: 'numeric', month: 'long', year: 'numeric' });

/** "Hoje", "Ontem" ou a data por extenso, no fuso local. */
export function dayLabel(iso: string, now: number): string {
  const key = dayKey(iso);
  if (key === dayKey(now)) return 'Hoje';
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (key === dayKey(yesterday)) return 'Ontem';
  return longDate.format(new Date(iso));
}

/** Agrupa mensagens (já ordenadas) por dia local, preservando a ordem. */
export function groupMessagesByDay<T extends { createdAt: string }>(messages: T[], now: number): DayGroup<T>[] {
  const groups: DayGroup<T>[] = [];
  for (const message of messages) {
    const key = dayKey(message.createdAt);
    const last = groups.at(-1);
    if (last && last.key === key) last.messages.push(message);
    else groups.push({ key, label: dayLabel(message.createdAt, now), messages: [message] });
  }
  return groups;
}
