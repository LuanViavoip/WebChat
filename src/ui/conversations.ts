import type { Conversation, ConversationId, ConversationSummary } from '../domain/conversation';
import type { Directory, StaffRole, StaffUser } from '../domain/identity';
import { can } from '../domain/permissions';
import { own } from '../domain/records';
import { liveActivity, type LiveActivity } from './liveActivity';

/** Texto do role na UI. */
export function roleLabel(role: StaffRole): string {
  switch (role) {
    case 'admin':
      return 'Administrador';
    case 'supervisor':
      return 'Supervisor(a)';
    case 'agent':
      return 'Agente';
    default: {
      const exhaustive: never = role;
      return exhaustive;
    }
  }
}

/** O outro participante de uma direta (do ponto de vista de `me`). Grupo: `undefined`. */
export function otherParticipant(
  conversation: Conversation,
  me: StaffUser,
  directory: Directory,
): StaffUser | undefined {
  if (conversation.kind !== 'direct') {
    return undefined;
  }
  const [first, second] = conversation.participants;
  return own(directory.users, first === me.id ? second : first);
}

export function conversationTitle(conversation: Conversation, me: StaffUser, directory: Directory): string {
  if (conversation.kind === 'group') {
    return conversation.title;
  }
  return otherParticipant(conversation, me, directory)?.name ?? 'Conversa';
}

export const NO_MESSAGES_PREVIEW = 'Nenhuma mensagem ainda';

/** O que a Sidebar desenha de uma conversa. */
export type ConversationItem = {
  id: ConversationId;
  title: string;
  preview: string;
  /** Vazio quando a conversa ainda não tem mensagens. */
  timeLabel: string;
  timeIso: string;
  unread: number;
  activity: LiveActivity;
};

export type ThreadActivityInput = Parameters<typeof liveActivity>[0];

/** Hoje: hora; ontem: "Ontem"; antes: dd/mm/aaaa. */
export function conversationTimeLabel(iso: string, now: Date = new Date()): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  const startOf = (value: Date) => new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime();
  const diffDays = Math.round((startOf(now) - startOf(date)) / 86_400_000);
  if (diffDays === 0) {
    return date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  }
  if (diffDays === 1) {
    return 'Ontem';
  }
  return date.toLocaleDateString('pt-BR');
}

export function conversationItem(
  summary: ConversationSummary,
  me: StaffUser,
  directory: Directory,
  activity: LiveActivity,
  now: Date = new Date(),
): ConversationItem {
  const hasMessages = Boolean(summary.preview);
  return {
    id: summary.id,
    title: conversationTitle(summary.conversation, me, directory),
    preview: summary.preview ?? NO_MESSAGES_PREVIEW,
    timeLabel: hasMessages ? conversationTimeLabel(summary.lastActivityAt, now) : '',
    timeIso: summary.lastActivityAt,
    unread: summary.unread,
    activity,
  };
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

/** Busca por título/prévia e filtro Não lidas. Conversa com erro fica à vista (o erro não pode sumir). */
export function filterConversations(
  items: readonly ConversationItem[],
  query: string,
  filter: 'all' | 'unread',
): ConversationItem[] {
  const needle = query.trim().toLowerCase();
  return items.filter((item) => {
    if (item.activity === 'error') {
      return true;
    }
    if (filter === 'unread' && item.unread === 0) {
      return false;
    }
    if (!needle) {
      return true;
    }
    return `${item.title} ${item.preview}`.toLowerCase().includes(needle);
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

/** Com quem `me` pode abrir uma direta: a mesma `can(direct.open)` que o servidor usa (mesma empresa, ativo, com chat.use). */
export function openableColleagues(me: StaffUser, directory: Directory): StaffUser[] {
  return Object.values(directory.users).filter((candidate) => can(me, { type: 'direct.open', with: candidate }, directory).ok);
}
