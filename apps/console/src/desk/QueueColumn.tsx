import type { ConversationSummary, QueueSummary } from '@viavoip/protocol';
import type { KeyboardEvent } from 'react';
import { formatDuration, visitorLabel } from './format.js';
import { unreadVisitorCount, type MessageBuckets, type ReadCursors } from './state.js';

type Props = {
  queues: QueueSummary[];
  conversations: ConversationSummary[];
  messages: MessageBuckets;
  cursors: ReadCursors;
  selectedId: string | null;
  selfId: string;
  now: number;
  active: boolean;
  onSelect: (conversationId: string) => void;
};

export function QueueColumn({
  queues,
  conversations,
  messages,
  cursors,
  selectedId,
  selfId,
  now,
  active,
  onSelect,
}: Props) {
  const ordered = orderedContacts(queues, conversations, selfId);

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    const index = ordered.findIndex((item) => item.id === selectedId);
    const nextIndex = event.key === 'ArrowDown' ? Math.min(ordered.length - 1, index + 1) : Math.max(0, index - 1);
    const next = ordered[nextIndex];
    if (next) onSelect(next.id);
  }

  return (
    <div className={active ? 'pane queue-pane active' : 'pane queue-pane'} data-pane="queues" onKeyDown={onKeyDown}>
      <h2>Filas</h2>
      {queues.length === 0 ? <p className="muted">Nenhuma fila autorizada.</p> : null}
      <div role="listbox" aria-label="Contatos" tabIndex={0}>
        {queues.map((queue) => {
          const waiting = conversations
            .filter((item) => item.queueId === queue.id && item.status === 'queued')
            .sort((left, right) => left.queuedAt.localeCompare(right.queuedAt));
          const mine = conversations
            .filter((item) => item.agentId === selfId && item.queueId === queue.id && item.status !== 'queued')
            .sort((left, right) => (left.assignedAt ?? left.queuedAt).localeCompare(right.assignedAt ?? right.queuedAt));
          return (
            <section key={queue.id} aria-label={queue.name}>
              <header className="queue-head">
                <strong>{queue.name}</strong>
                <span>{waiting.length} aguardando</span>
              </header>
              <ContactGroup
                title="Aguardando"
                contacts={waiting}
                messages={messages}
                cursors={cursors}
                selectedId={selectedId}
                now={now}
                onSelect={onSelect}
              />
              <ContactGroup
                title="Meus atendimentos"
                contacts={mine}
                messages={messages}
                cursors={cursors}
                selectedId={selectedId}
                now={now}
                onSelect={onSelect}
              />
            </section>
          );
        })}
      </div>
      {ordered.length === 0 ? <p className="muted">Nenhum contato na fila.</p> : null}
    </div>
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
}: {
  title: string;
  contacts: ConversationSummary[];
  messages: MessageBuckets;
  cursors: ReadCursors;
  selectedId: string | null;
  now: number;
  onSelect: (conversationId: string) => void;
}) {
  if (contacts.length === 0) return null;
  return (
    <div className="contact-group">
      <p className="group-label">{title}</p>
      {contacts.map((conversation) => {
        const unread = unreadVisitorCount(messages[conversation.id], cursors[conversation.id]);
        const waiting = conversation.status === 'queued';
        return (
          <button
            key={conversation.id}
            type="button"
            role="option"
            aria-selected={conversation.id === selectedId}
            data-testid="conversation"
            className={conversation.id === selectedId ? 'selected' : ''}
            onClick={() => onSelect(conversation.id)}
          >
            <strong>{visitorLabel(conversation.visitorDisplayName)}</strong>
            <span>
              {waiting ? `Espera ${formatDuration(conversation.queuedAt, now)}` : conversation.queueName}
              {unread > 0 ? <em data-testid="unread">{unread}</em> : null}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function orderedContacts(
  queues: QueueSummary[],
  conversations: ConversationSummary[],
  selfId: string,
): ConversationSummary[] {
  const ordered: ConversationSummary[] = [];
  for (const queue of queues) {
    const waiting = conversations
      .filter((item) => item.queueId === queue.id && item.status === 'queued')
      .sort((left, right) => left.queuedAt.localeCompare(right.queuedAt));
    const mine = conversations.filter(
      (item) => item.agentId === selfId && item.queueId === queue.id && item.status !== 'queued',
    );
    ordered.push(...waiting, ...mine);
  }
  return ordered;
}
