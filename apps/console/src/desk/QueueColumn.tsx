import type { ConversationStatus, ConversationSummary, QueueSummary } from '@viavoip/protocol';
import { Inbox } from 'lucide-react';
import type { KeyboardEvent } from 'react';
import { Avatar } from '../ui/Avatar.js';
import type { Tone } from '../ui/Card.js';
import { EmptyState, LoadingState } from '../ui/states.js';
import { StatusBadge } from '../ui/StatusBadge.js';
import { formatClock, formatDuration, statusLabel, visitorLabel } from './format.js';
import { lastMessagePreview, unreadVisitorCount, type MessageBuckets, type ReadCursors } from './state.js';

type Props = {
  queues: QueueSummary[];
  conversations: ConversationSummary[];
  messages: MessageBuckets;
  cursors: ReadCursors;
  selectedId: string | null;
  selfId: string;
  supervisory: boolean;
  now: number;
  hidden: boolean;
  loading: boolean;
  onSelect: (conversationId: string) => void;
};

export function statusTone(status: ConversationStatus): Tone {
  switch (status) {
    case 'queued':
      return 'warning';
    case 'assigned':
      return 'success';
    case 'awaiting_survey':
      return 'info';
    case 'closed':
      return 'neutral';
    default: {
      const unexpected: never = status;
      return unexpected;
    }
  }
}

export function QueueColumn({
  queues,
  conversations,
  messages,
  cursors,
  selectedId,
  selfId,
  supervisory,
  now,
  hidden,
  loading,
  onSelect,
}: Props) {
  const ordered = orderedContacts(queues, conversations, selfId, supervisory);

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    const index = ordered.findIndex((item) => item.id === selectedId);
    const nextIndex = event.key === 'ArrowDown' ? Math.min(ordered.length - 1, index + 1) : Math.max(0, index - 1);
    const next = ordered[nextIndex];
    if (next) onSelect(next.id);
  }

  return (
    <section className="desk-card desk-queues" data-pane="queues" aria-label="Filas" hidden={hidden} onKeyDown={onKeyDown}>
      <header className="desk-card__head">
        <h2>Filas</h2>
      </header>
      {loading ? <LoadingState label="Conectando à central…" /> : null}
      {!loading && queues.length === 0 ? <EmptyState icon={Inbox} title="Nenhuma fila autorizada" description="Peça a um administrador para vincular você a uma fila." /> : null}
      <div className="desk-queues__list" role="listbox" aria-label="Contatos" tabIndex={0}>
        {queues.map((queue) => {
          const waiting = conversations
            .filter((item) => item.queueId === queue.id && item.status === 'queued')
            .sort((left, right) => left.queuedAt.localeCompare(right.queuedAt));
          const mine = conversations
            .filter((item) => (supervisory || item.agentId === selfId) && item.queueId === queue.id && item.status !== 'queued')
            .sort((left, right) => (left.assignedAt ?? left.queuedAt).localeCompare(right.assignedAt ?? right.queuedAt));
          return (
            <section key={queue.id} className="queue-card" aria-label={queue.name}>
              <header className="queue-card__head">
                <strong>{queue.name}</strong>
                <StatusBadge tone={waiting.length > 0 ? 'warning' : 'neutral'}>{waiting.length} aguardando</StatusBadge>
              </header>
              <ContactGroup
                title="Aguardando"
                contacts={waiting}
                messages={messages}
                cursors={cursors}
                selectedId={selectedId}
                now={now}
                onSelect={onSelect}
                supervisory={supervisory}
              />
              <ContactGroup
                title={supervisory ? 'Atendimentos' : 'Meus atendimentos'}
                contacts={mine}
                messages={messages}
                cursors={cursors}
                selectedId={selectedId}
                now={now}
                onSelect={onSelect}
                supervisory={supervisory}
              />
            </section>
          );
        })}
      </div>
      {!loading && queues.length > 0 && ordered.length === 0 ? <p className="desk-queues__empty">Nenhum contato na fila.</p> : null}
    </section>
  );
}

function ContactGroup({
  title,
  contacts,
  messages,
  cursors,
  selectedId,
  now,
  onSelect,
  supervisory,
}: {
  title: string;
  contacts: ConversationSummary[];
  messages: MessageBuckets;
  cursors: ReadCursors;
  selectedId: string | null;
  now: number;
  onSelect: (conversationId: string) => void;
  supervisory: boolean;
}) {
  if (contacts.length === 0) return null;
  return (
    <div className="contact-group">
      <p className="contact-group__label">{title}</p>
      {contacts.map((conversation) => {
        const unread = unreadVisitorCount(messages[conversation.id], cursors[conversation.id]);
        const preview = lastMessagePreview(messages[conversation.id]);
        const name = visitorLabel(conversation.visitorDisplayName);
        const selected = conversation.id === selectedId;
        const waited = formatDuration(
          conversation.queuedAt,
          conversation.assignedAt ? Date.parse(conversation.assignedAt) : conversation.endedAt ? Date.parse(conversation.endedAt) : now,
        );
        const meta = supervisory
          ? `${conversation.agentName ?? 'Sem agente'} · Espera ${waited}`
          : conversation.status === 'queued' ? `Espera ${formatDuration(conversation.queuedAt, now)}` : conversation.queueName;
        return (
          <button
            key={conversation.id}
            type="button"
            role="option"
            aria-selected={selected}
            data-testid="conversation"
            className={selected ? 'contact is-selected' : 'contact'}
            onClick={() => onSelect(conversation.id)}
          >
            <Avatar name={visitorLabel(conversation.visitorDisplayName)} size={40} />
            <span className="contact__body">
              <span className="contact__row">
                <strong>{name}</strong>
                <time dateTime={preview?.createdAt ?? conversation.queuedAt}>{formatClock(preview?.createdAt ?? conversation.queuedAt)}</time>
              </span>
              <span className="contact__preview">{previewText(preview, supervisory)}</span>
              <span className="contact__meta">
                <StatusBadge tone={statusTone(conversation.status)}>{statusLabel(conversation.status)}</StatusBadge>
                <span className="contact__wait">{meta}</span>
                {unread > 0 ? <em className="contact__unread" data-testid="unread">{unread}</em> : null}
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

function previewText(preview: ReturnType<typeof lastMessagePreview>, supervisory: boolean): string {
  if (!preview) return 'Sem mensagens ainda';
  if (preview.senderType === 'agent') return `${supervisory ? 'Agente' : 'Você'}: ${preview.text}`;
  return preview.text;
}

function orderedContacts(
  queues: QueueSummary[],
  conversations: ConversationSummary[],
  selfId: string,
  supervisory: boolean,
): ConversationSummary[] {
  const ordered: ConversationSummary[] = [];
  for (const queue of queues) {
    const waiting = conversations
      .filter((item) => item.queueId === queue.id && item.status === 'queued')
      .sort((left, right) => left.queuedAt.localeCompare(right.queuedAt));
    const mine = conversations.filter(
      (item) => (supervisory || item.agentId === selfId) && item.queueId === queue.id && item.status !== 'queued',
    );
    ordered.push(...waiting, ...mine);
  }
  return ordered;
}
