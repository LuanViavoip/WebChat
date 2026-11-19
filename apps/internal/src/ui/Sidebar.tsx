import { CircleDashed, LogOut, MessageSquarePlus, Search, Settings, Users, UsersRound, type LucideIcon } from 'lucide-react';
import { useCallback, useMemo, useRef, useState } from 'react';
import type { ConversationId } from '@viavoip/internal-domain';
import type { Directory, Ilha, StaffUser } from '@viavoip/internal-domain';
import {
  conversationInitials,
  emptyConversationCopy,
  filterSidebarItems,
  roleLabel,
  type ConversationItem,
} from './conversations';
import { liveActivityLabel } from './liveActivity';
import { NewConversationDialog } from './NewConversationDialog';
import { NewGroupControls, type GroupDraft } from './admin/NewGroupControls';

export type ConversationSections = {
  priority: readonly ConversationItem[];
  colleagues: readonly ConversationItem[];
};

export type SidebarSlotView = {
  readonly id: string;
  readonly label: string;
  readonly icon: LucideIcon;
  readonly badge?: number;
  readonly onOpen: () => void;
};

export type SidebarSlotMenuItem = {
  readonly label: string;
  readonly onSelect: () => void;
};

export function Sidebar({
  me,
  tenantName,
  sections,
  selectedConversationId,
  note,
  newConversationCandidates,
  onSelect,
  onOpenDirect,
  onSwitchUser,
  onOpenAdmin,
  onOpenTeam,
  groupIlhas,
  directory,
  onCreateGroup,
  groupIds = [],
  slotViews,
  slotMenuItems,
}: {
  me: StaffUser | null;
  tenantName: string;
  sections: ConversationSections;
  selectedConversationId: ConversationId | null;
  /** Estado da conexão quando ainda não há conversas para mostrar ("Conectando…"). */
  note: string;
  /** Colegas com quem `me` pode abrir uma direta (já filtrados por `can`). */
  newConversationCandidates: readonly StaffUser[];
  onSelect: (id: ConversationId) => void;
  onOpenDirect: (user: StaffUser) => void;
  onSwitchUser: () => void;
  /** Presente só quando `me` tem `admin.console`. */
  onOpenAdmin?: () => void;
  /** Presente só quando `me` tem `agents.manage` e supervisiona ilhas (tela Equipe). */
  onOpenTeam?: () => void;
  /** Presente só quando `me` tem `group.manage`: as ilhas que ele pode escolher para o grupo. */
  groupIlhas?: readonly Ilha[];
  directory?: Directory;
  onCreateGroup?: (draft: GroupDraft) => Promise<boolean>;
  groupIds?: readonly ConversationId[];
  slotViews?: readonly SidebarSlotView[];
  slotMenuItems?: readonly SidebarSlotMenuItem[];
}) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<'all' | 'unread' | 'groups'>('all');
  const [pickerOpen, setPickerOpen] = useState(false);
  const newButtonRef = useRef<HTMLButtonElement>(null);
  const priority = useMemo(
    () => filterSidebarItems(sections.priority, query, filter === 'groups' ? 'all' : filter).filter((item) => filter !== 'groups' || groupIds.includes(item.id)),
    [sections.priority, query, filter, groupIds],
  );
  const colleagues = useMemo(
    () => filterSidebarItems(sections.colleagues, query, filter === 'groups' ? 'all' : filter).filter((item) => filter !== 'groups' || groupIds.includes(item.id)),
    [sections.colleagues, query, filter, groupIds],
  );
  const total = sections.priority.length + sections.colleagues.length;
  const visible = priority.length + colleagues.length;

  const closePicker = useCallback(() => {
    setPickerOpen(false);
    requestAnimationFrame(() => {
      newButtonRef.current?.focus();
    });
  }, []);

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
          <button
            ref={newButtonRef}
            type="button"
            className="icon-button"
            aria-label="Nova conversa"
            title="Nova conversa"
            disabled={me === null}
            onClick={() => {
              setPickerOpen(true);
            }}
          >
            <MessageSquarePlus size={20} strokeWidth={1.7} aria-hidden="true" />
          </button>
          <button
            type="button"
            className="icon-button"
            aria-label="Trocar usuário"
            title="Trocar usuário"
            onClick={onSwitchUser}
          >
            <LogOut size={20} strokeWidth={1.7} aria-hidden="true" />
          </button>
        </div>
      </div>
      {me ? (
        <div className="sidebar-identity">
          <p className="sidebar-identity-copy">
            <span className="sidebar-identity-name">{me.name}</span>
            <span className="sidebar-identity-role">
              {roleLabel(me.role)} · {tenantName}
            </span>
          </p>
          {onOpenAdmin ? (
            <button type="button" className="sidebar-admin-link" data-open-view="admin" onClick={onOpenAdmin}>
              <Settings size={16} strokeWidth={1.8} aria-hidden="true" />
              Administração
            </button>
          ) : null}
          {onOpenTeam ? (
            <button type="button" className="sidebar-admin-link" data-open-view="team" onClick={onOpenTeam}>
              <UsersRound size={16} strokeWidth={1.8} aria-hidden="true" />
              Equipe
            </button>
          ) : null}
          {slotViews?.map((view) => {
            const Icon = view.icon;
            return (
              <button
                key={view.id}
                type="button"
                className="sidebar-admin-link"
                data-open-view={`slot:${view.id}`}
                onClick={view.onOpen}
              >
                <Icon size={16} strokeWidth={1.8} aria-hidden="true" />
                <span>{view.label}</span>
                {view.badge !== undefined && view.badge > 0 ? (
                  <span className="sidebar-slot-badge">{view.badge}</span>
                ) : null}
              </button>
            );
          })}
          {slotMenuItems?.map((item) => (
            <button
              key={item.label}
              type="button"
              className="sidebar-admin-link"
              data-slot-menu-item=""
              onClick={item.onSelect}
            >
              {item.label}
            </button>
          ))}
        </div>
      ) : null}
      {groupIlhas && me && directory && onCreateGroup ? <NewGroupControls ilhas={groupIlhas} me={me} directory={directory} onCreate={onCreateGroup} /> : null}
      <div className="sidebar-search">
        <Search size={16} strokeWidth={1.8} aria-hidden="true" />
        <label className="sidebar-search-field">
          <span className="sr-only">Pesquisar conversa</span>
          <input
            type="search"
            value={query}
            placeholder="Pesquisar conversa"
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
          aria-pressed={filter === 'groups'}
          className={filter === 'groups' ? 'chip chip-on' : 'chip'}
          onClick={() => { setFilter('groups'); }}
        >Grupos</button>
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
      <div className="conversation-scroll">
        {total === 0 && note ? <p className="conversation-empty">{note}</p> : null}
        {total > 0 && visible === 0 ? (
          <p className="conversation-empty">{filter === 'groups' ? 'Nenhum grupo encontrado' : emptyConversationCopy(filter, query)}</p>
        ) : null}
        {total === 0 && !note ? <p className="conversation-empty">Nenhuma conversa</p> : null}
        <ConversationSection
          id="section-priority"
          title="Grupos e supervisão"
          items={priority}
          selectedConversationId={selectedConversationId}
          onSelect={onSelect}
        />
        <ConversationSection
          id="section-colleagues"
          title="Colegas"
          items={colleagues}
          selectedConversationId={selectedConversationId}
          onSelect={onSelect}
        />
      </div>
      <NewConversationDialog
        open={pickerOpen}
        candidates={newConversationCandidates}
        onClose={closePicker}
        onPick={(user) => {
          closePicker();
          onOpenDirect(user);
        }}
      />
    </aside>
  );
}

function ConversationSection({
  id,
  title,
  items,
  selectedConversationId,
  onSelect,
}: {
  id: string;
  title: string;
  items: readonly ConversationItem[];
  selectedConversationId: ConversationId | null;
  onSelect: (id: ConversationId) => void;
}) {
  if (items.length === 0) {
    return null;
  }
  return (
    <section className="conversation-section" aria-labelledby={id}>
      <h2 id={id} className="conversation-section-title">
        {title}
      </h2>
      <ul className="conversation-list">
        {items.map((item) => {
          const selected = item.id === selectedConversationId;
          const activityLabel = liveActivityLabel(item.activity);
          return (
            <li key={item.id}>
              <button
                type="button"
                className={`conversation-item${selected ? ' is-active' : ''}`}
                data-conversation-id={item.id}
                {...(selected ? { 'aria-current': 'true' as const } : {})}
                onClick={() => {
                  onSelect(item.id);
                }}
              >
                <div className="avatar avatar-contact" aria-hidden="true">
                  {conversationInitials(item.title)}
                </div>
                <span className="conversation-copy">
                  <span className="conversation-row">
                    <span className="conversation-title">{item.title}</span>
                    {item.timeLabel ? (
                      <time className="conversation-time" dateTime={item.timeIso}>
                        {item.timeLabel}
                      </time>
                    ) : null}
                  </span>
                  <span className="conversation-row">
                    <span className="conversation-preview">{item.preview}</span>
                    {activityLabel ? (
                      <span className={`live-activity-badge${item.activity === 'error' ? ' is-error' : ''}`}>
                        {activityLabel}
                      </span>
                    ) : null}
                    {item.unread > 0 ? (
                      <span className="unread-badge">
                        <span aria-hidden="true">{item.unread}</span>
                        <span className="sr-only">
                          {item.unread === 1 ? '1 mensagem não lida' : `${String(item.unread)} mensagens não lidas`}
                        </span>
                      </span>
                    ) : null}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
