export type ChatHistoryFields = {
  smPane?: 'list' | 'chat';
  conversationId?: string;
};

function asStateRecord(current: unknown): Record<string, unknown> {
  if (current !== null && typeof current === 'object' && !Array.isArray(current)) {
    return { ...(current as Record<string, unknown>) };
  }
  return {};
}

export function mergeHistoryState(current: unknown, patch: ChatHistoryFields): Record<string, unknown> {
  return { ...asStateRecord(current), ...patch };
}

export function historyPane(state: unknown): 'list' | 'chat' {
  return asStateRecord(state)['smPane'] === 'chat' ? 'chat' : 'list';
}

export function historyConversationId(state: unknown): string | undefined {
  const value = asStateRecord(state)['conversationId'];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}
