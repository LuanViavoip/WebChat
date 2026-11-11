import { CircleDashed, MessageSquarePlus, Search, Users } from 'lucide-react';
import { useMemo, useState } from 'react';
import { CLIENT_CONVERSATIONS, emptyConversationCopy, filterConversations, isLiveConversation } from './conversations';

export function Sidebar({
  preview,
  selectedConversationId,
  onSelect,
}: {
  preview: string;
  selectedConversationId: string;
  onSelect: (id: string) => void;
}) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<'all' | 'unread'>('all');
  const items = useMemo(
    () => filterConversations(CLIENT_CONVERSATIONS, query, filter, preview),
    [filter, preview, query],
  );

  return (
    <aside className="wa-sidebar" aria-label="Lista de conversas">
      <div className="sidebar-top">
        <h1 className="brand-wordmark">ViaVoip</h1>
        <div className="header-actions">
          <button type="button" className="icon-button" aria-label="Comunidades (em breve)" title="em breve" disabled>
            <Users size={20} strokeWidth={1.7} aria-hidden="true" />
          </button>
          <button type="button" className="icon-button" aria-label="Status (em breve)" title="em breve" disabled>
            <CircleDashed size={20} strokeWidth={1.7} aria-hidden="true" />
          </button>
          <button type="button" className="icon-button" aria-label="Nova conversa (em breve)" title="em breve" disabled>
            <MessageSquarePlus size={20} strokeWidth={1.7} aria-hidden="true" />
          </button>
        </div>
      </div>
      <div className="sidebar-search">
        <Search size={16} strokeWidth={1.8} aria-hidden="true" />
        <label className="sidebar-search-field">
          <span className="sr-only">Pesquisar conversa</span>
          <input
            type="search"
            value={query}
            placeholder="Pesquisar ou começar uma nova conversa"
            aria-label="Pesquisar conversa"
            onChange={(event) => {
              setQuery(event.target.value);
            }}
          />
        </label>
      </div>
      <div className="sidebar-filters" role="group" aria-label="Filtros da lista">
        <button
          type="button"
          aria-pressed={filter === 'all'}
          className={filter === 'all' ? 'chip chip-on' : 'chip'}
          onClick={() => {
            setFilter('all');
          }}
        >
          Tudo
        </button>
        <button
          type="button"
          aria-pressed={filter === 'unread'}
          className={filter === 'unread' ? 'chip chip-on' : 'chip'}
          onClick={() => {
            setFilter('unread');
          }}
        >
          Não lidas
        </button>
      </div>
      {items.length === 0 ? (
        <p className="conversation-empty">{emptyConversationCopy(filter, query)}</p>
      ) : (
        <ul className="conversation-list">
          {items.map((item) => {
            const selected = item.id === selectedConversationId;
            return (
              <li key={item.id}>
                <button
                  type="button"
                  className={`conversation-item${selected ? ' is-active' : ''}`}
                  {...(selected ? { 'aria-current': 'true' as const } : {})}
                  onClick={() => {
                    onSelect(item.id);
                  }}
                >
                  <div className="avatar avatar-ics" aria-hidden="true">
                    ICS
                  </div>
                  <span className="conversation-copy">
                    <span className="conversation-row">
                      <span className="conversation-title">{item.title}</span>
                      <time className="conversation-time">{item.timeLabel}</time>
                    </span>
                    <span className="conversation-row">
                      <span className="conversation-preview">
                        {isLiveConversation(item.id) ? preview : item.preview}
                      </span>
                      {item.unread > 0 ? <span className="unread-badge">{item.unread}</span> : null}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </aside>
  );
}
