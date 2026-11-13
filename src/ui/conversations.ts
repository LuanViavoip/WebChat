import type { ChatMessage } from '../domain/message';

export const LIVE_CONVERSATION_ID = 'conversa-teste';

export type ConversationPreview = {
  id: string;
  title: string;
  preview: string;
  timeLabel: string;
  unread: number;
  transcript: ChatMessage[];
};

export const CLIENT_CONVERSATIONS: ConversationPreview[] = [
  {
    id: LIVE_CONVERSATION_ID,
    title: 'Conversa de teste',
    preview: 'Nenhuma mensagem ainda',
    timeLabel: 'hoje',
    unread: 0,
    transcript: [],
  },
];

export function isLiveConversation(id: string): boolean {
  return id === LIVE_CONVERSATION_ID;
}

export function conversationById(id: string): ConversationPreview {
  const found = CLIENT_CONVERSATIONS.find((item) => item.id === id);
  if (found) {
    return found;
  }
  const fallback = CLIENT_CONVERSATIONS[0];
  if (!fallback) {
    throw new Error('Nenhuma conversa configurada');
  }
  return fallback;
}

export function conversationInitials(title: string): string {
  const parts = title.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    const first = parts[0]?.[0] ?? '';
    const second = parts[1]?.[0] ?? '';
    return `${first}${second}`.toUpperCase();
  }
  return title.slice(0, 2).toUpperCase() || '?';
}

export function filterConversations(
  items: ConversationPreview[],
  query: string,
  filter: 'all' | 'unread',
  activePreview: string,
  options?: { pinLive?: boolean },
): ConversationPreview[] {
  const needle = query.trim().toLowerCase();
  return items.filter((item) => {
    if (options?.pinLive && isLiveConversation(item.id)) {
      return true;
    }
    if (filter === 'unread' && item.unread === 0) {
      return false;
    }
    if (!needle) {
      return true;
    }
    const preview = isLiveConversation(item.id) ? activePreview : item.preview;
    return `${item.title} ${preview}`.toLowerCase().includes(needle);
  });
}

export function emptyConversationCopy(filter: 'all' | 'unread', query: string): string {
  if (query.trim().length > 0) {
    return 'Nenhum resultado encontrado';
  }
  if (filter === 'unread') {
    return 'Nenhuma conversa não lida';
  }
  return 'Nenhuma conversa';
}
