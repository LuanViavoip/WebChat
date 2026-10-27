import type { InternalMessage } from '@viavoip/protocol';

export type InternalHistoryRecovery = {
  messages: InternalMessage[];
  cursor: string | undefined;
  hasOlder: boolean;
};

export async function recoverInternalHistory(
  initialCursor: string | undefined,
  fetchPage: (afterMessageId?: string) => Promise<InternalMessage[]>,
): Promise<InternalHistoryRecovery> {
  if (!initialCursor) {
    const messages = await fetchPage();
    return {
      messages,
      cursor: messages.at(-1)?.id,
      hasOlder: messages.length === 50,
    };
  }

  let cursor = initialCursor;
  const messages = new Map<string, InternalMessage>();
  while (cursor) {
    const page = await fetchPage(cursor);
    for (const message of page) messages.set(message.id, message);
    if (page.length < 100) break;
    const nextCursor = page.at(-1)?.id;
    if (!nextCursor || nextCursor === cursor) break;
    cursor = nextCursor;
  }

  const ordered = [...messages.values()].sort((left, right) =>
    left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id),
  );
  return {
    messages: ordered,
    cursor: ordered.at(-1)?.id ?? initialCursor,
    hasOlder: false,
  };
}

export async function recoverAndCommitInternalHistory(
  initialCursor: string | undefined,
  fetchPage: (afterMessageId?: string) => Promise<InternalMessage[]>,
  commit: (recovery: InternalHistoryRecovery) => void,
): Promise<InternalHistoryRecovery> {
  const recovery = await recoverInternalHistory(initialCursor, fetchPage);
  commit(recovery);
  return recovery;
}
