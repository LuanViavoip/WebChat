import { ArrowLeft, Plus } from 'lucide-react';
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import type { AdminActionResult } from '../../chat/ChatSession';
import { inManagementScope } from '@viavoip/internal-domain';
import {
  canManageIlhasIn,
  canRegisterSupervisorIn,
  canUseCapabilityIn,
  type GrantLogEntry,
} from '@viavoip/internal-domain';
import { canReadGrantLog } from '@viavoip/internal-domain';
import type { Directory, Ilha, StaffUser } from '@viavoip/internal-domain';
import { own } from '@viavoip/internal-domain';
import { conversationInitials, roleLabel } from '../conversations';
import { useMediaQuery } from '../useMediaQuery';
import { DetailScroll, IlhaDetail, SCROLL_FOCUSABLE, NewDetailHeader, UserDetail } from './details';
import { NewAgentForm, NewIlhaForm, NewSupervisorForm } from './forms';
import { byName } from './helpers';
import { GrantLogList } from './GrantLogList';
import type { AdminActions, ConsoleContext, Selection } from './types';

export type ConsoleMode = 'admin' | 'team';
type Section = 'supervisors' | 'ilhas' | 'agents' | 'log';
type Feedback = { readonly kind: 'ok' | 'error'; readonly text: string };
type PendingFocus = 'detail' | 'list';

const SECTION_LABEL: Readonly<Record<Section, string>> = {
  supervisors: 'Supervisores',
  ilhas: 'Ilhas',
  agents: 'Agentes',
  log: 'Registro',
};

const NEW_LABEL: Readonly<Record<Exclude<Section, 'log'>, string>> = {
  supervisors: 'Novo supervisor',
  ilhas: 'Nova ilha',
  agents: 'Novo agente',
};

const OK_FEEDBACK_MS = 6000;

/**
 * O console de administração (Administração) e a tela Equipe do supervisor: o MESMO componente. As seções,
 * os botões e as chaves saem dos predicados `can*In` do domínio sobre o diretório vivo da sessão; a tela
 * não decide regra. Duas colunas (lista e detalhe) a partir de 901 px; alternadas abaixo disso.
 */
export function AdminConsole({
  mode,
  me,
  directory,
  grantLog,
  timeZone,
  actions,
  onClose,
}: {
  mode: ConsoleMode;
  me: StaffUser;
  directory: Directory;
  grantLog: readonly GrantLogEntry[] | null;
  timeZone: string;
  actions: AdminActions;
  onClose: () => void;
}) {
  const isMobile = useMediaQuery('(max-width: 900px)');
  const title = mode === 'admin' ? 'Administração' : 'Equipe';
  const [requested, setRequested] = useState<Section>(mode === 'admin' ? 'supervisors' : 'agents');
  const [selection, setSelection] = useState<Selection | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const pendingFocus = useRef<PendingFocus | null>(null);
  const shellRef = useRef<HTMLElement>(null);

  const sections = useMemo(() => {
    const list: Section[] = [];
    if (canRegisterSupervisorIn(directory, me.id).ok) {
      list.push('supervisors');
    }
    if (canManageIlhasIn(directory, me.id).ok) {
      list.push('ilhas');
    }
    if (canUseCapabilityIn(directory, me.id, 'agents.manage').ok) {
      list.push('agents');
    }
    if (canReadGrantLog(me)) {
      list.push('log');
    }
    return list;
  }, [directory, me]);
  const section: Section = sections.includes(requested) ? requested : (sections[0] ?? 'log');

  // O primeiro carregamento do registro; depois o evento `grantLog` o mantém vivo.
  const readsLog = canReadGrantLog(me);
  useEffect(() => {
    if (readsLog) {
      void actions.loadGrantLog();
    }
  }, [actions, readsLog]);

  useEffect(() => {
    if (!feedback || feedback.kind !== 'ok') {
      return;
    }
    const timer = setTimeout(() => {
      setFeedback(null);
    }, OK_FEEDBACK_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [feedback]);

  const people = useMemo(
    () => ({
      supervisors: byName(Object.values(directory.users).filter((u) => u.role === 'supervisor' && inManagementScope(directory, me, u))),
      agents: byName(Object.values(directory.users).filter((u) => u.role === 'agent' && inManagementScope(directory, me, u))),
      ilhas: byName(Object.values(directory.ilhas)),
    }),
    [directory, me],
  );
  const self = own(directory.users, me.id) ?? me;

  const resolvedUser =
    selection?.kind === 'user'
      ? (selection.id === self.id ? self : [...people.supervisors, ...people.agents].find((user) => user.id === selection.id))
      : undefined;
  const resolvedIlha = selection?.kind === 'ilha' ? own(directory.ilhas, selection.id) : undefined;
  const hasDetail =
    selection?.kind === 'new' || resolvedUser !== undefined || (resolvedIlha !== undefined && section === 'ilhas');
  const detailVisible = detailOpen && hasDetail;

  const perform = useCallback(
    async <T,>(call: () => Promise<AdminActionResult<T>>, success: (value: T) => string): Promise<AdminActionResult<T>> => {
      // Uma ação por vez: reentrada (duplo clique, Enter repetido) é ignorada, sem chamar o servidor nem mexer no aviso.
      if (busyRef.current) {
        return { ok: false, message: '' };
      }
      busyRef.current = true;
      setBusy(true);
      setFeedback(null);
      try {
        const result = await call();
        setFeedback(result.ok ? { kind: 'ok', text: success(result.value) } : { kind: 'error', text: result.message });
        return result;
      } finally {
        busyRef.current = false;
        setBusy(false);
      }
    },
    [],
  );
  const fail = useCallback((message: string) => {
    setFeedback({ kind: 'error', text: message });
  }, []);

  function open(next: Selection, focus: PendingFocus | null) {
    setFeedback(null);
    setSelection(next);
    setDetailOpen(true);
    pendingFocus.current = focus;
  }

  const ctx: ConsoleContext = {
    me,
    directory,
    grantLog,
    timeZone,
    actions,
    busy,
    perform,
    fail,
    // Depois de cadastrar/criar o foco vai para o item novo (o formulário some e levaria o foco junto).
    select: (next) => {
      setSelection(next);
      setDetailOpen(true);
      pendingFocus.current = 'detail';
    },
  };

  function chooseSection(next: Section) {
    setRequested(next);
    setSelection(null);
    setDetailOpen(false);
    setFeedback(null);
  }

  function backToList() {
    setFeedback(null);
    setDetailOpen(false);
    pendingFocus.current = 'list';
  }

  useEffect(() => {
    const target = pendingFocus.current;
    if (!target) {
      return;
    }
    pendingFocus.current = null;
    const root = shellRef.current;
    if (!root) {
      return;
    }
    if (target === 'detail') {
      const field = root.querySelector<HTMLElement>('.admin-detail [data-autofocus]');
      (field ?? root.querySelector<HTMLElement>('.admin-detail [data-detail-header]'))?.focus();
      return;
    }
    const key = selection?.kind === 'user' || selection?.kind === 'ilha' ? selection.id : undefined;
    const origin = key ? root.querySelector<HTMLElement>(`[data-item-id="${CSS.escape(key)}"]`) : null;
    (origin ?? root.querySelector<HTMLElement>('.admin-chips-bar button, .admin-new'))?.focus();
  }, [detailOpen, selection]);

  // Formulário novo sempre leva o foco ao campo Nome; num item existente, só no mobile (a lista some e o foco iria junto).
  const selectItem = (next: Selection) => {
    open(next, next.kind === 'new' || isMobile ? 'detail' : null);
  };

  const level = isMobile ? 1 : 2;
  const content = detailContent();
  function detailContent() {
    if (!detailVisible && isMobile) {
      return null;
    }
    if (selection?.kind === 'new') {
      return (
        <>
          <NewDetailHeader title={newTitle(section)} onBack={backToList} level={level} />
          <DetailScroll label={newTitle(section)}>
            {section === 'supervisors' ? <NewSupervisorForm ctx={ctx} ilhas={people.ilhas} /> : null}
            {section === 'agents' ? <NewAgentForm ctx={ctx} /> : null}
            {section === 'ilhas' ? <NewIlhaForm ctx={ctx} supervisors={people.supervisors} /> : null}
          </DetailScroll>
        </>
      );
    }
    if (resolvedUser && section !== 'ilhas' && section !== 'log') {
      return <UserDetail key={resolvedUser.id} ctx={ctx} target={resolvedUser} onBack={backToList} level={level} />;
    }
    if (resolvedIlha && section === 'ilhas') {
      return <IlhaDetail key={resolvedIlha.id} ctx={ctx} ilha={resolvedIlha} onBack={backToList} level={level} />;
    }
    return (
      <div className="chat-empty-state">
        <p>{section === 'log' ? 'O registro mostra quem concedeu ou revogou cada permissão.' : 'Selecione uma pessoa ou ilha para ver os detalhes.'}</p>
      </div>
    );
  }

  const showSelfRow = section === sections.find((item) => item === 'supervisors' || item === 'agents');

  return (
    <section
      ref={shellRef}
      className="wa-shell admin-shell"
      data-mobile-pane={detailVisible ? 'chat' : 'list'}
      data-admin-mode={mode}
      aria-label={title}
    >
      <aside className="wa-sidebar admin-list" aria-label={`Lista de ${title}`}>
        <div className="sidebar-top">
          <button type="button" className="icon-button" aria-label="Voltar ao chat" title="Voltar ao chat" onClick={onClose}>
            <ArrowLeft size={20} strokeWidth={1.7} aria-hidden="true" />
          </button>
          <h1 className="admin-title">{title}</h1>
        </div>
        {sections.length > 1 ? (
          <div className="sidebar-filters admin-chips-bar" role="group" aria-label="Seções">
            {sections.map((item) => (
              <button
                key={item}
                type="button"
                aria-pressed={section === item}
                className={section === item ? 'chip chip-on' : 'chip'}
                onClick={() => {
                  chooseSection(item);
                }}
              >
                {SECTION_LABEL[item]}
              </button>
            ))}
          </div>
        ) : null}
        {section !== 'log' ? (
          <button
            type="button"
            className="admin-new"
            aria-pressed={selection?.kind === 'new'}
            onClick={() => {
              selectItem({ kind: 'new' });
            }}
          >
            <Plus size={16} strokeWidth={2} aria-hidden="true" />
            {NEW_LABEL[section]}
          </button>
        ) : null}
        <div
          className="conversation-scroll"
          {...(section === 'log' ? { role: 'region', ...SCROLL_FOCUSABLE, 'aria-label': 'Registro de permissões, rolável' } : {})}
        >
          {section === 'log' ? (
            <div className="admin-log-pane">
              <h2 className="conversation-section-title">Registro de permissões</h2>
              <GrantLogList entries={grantLog} directory={directory} timeZone={timeZone} label="Registro de permissões" />
            </div>
          ) : null}
          {showSelfRow ? (
            <PeopleSection
              title="Você"
              users={[self]}
              directory={directory}
              selection={selection}
              onSelect={(user) => {
                selectItem({ kind: 'user', id: user.id });
              }}
            />
          ) : null}
          {section === 'supervisors' ? (
            <PeopleSection
              title="Supervisores"
              users={people.supervisors}
              directory={directory}
              selection={selection}
              empty="Nenhum supervisor cadastrado."
              onSelect={(user) => {
                selectItem({ kind: 'user', id: user.id });
              }}
            />
          ) : null}
          {section === 'agents' ? (
            <PeopleSection
              title="Agentes"
              users={people.agents}
              directory={directory}
              selection={selection}
              empty="Nenhum agente nas suas ilhas."
              onSelect={(user) => {
                selectItem({ kind: 'user', id: user.id });
              }}
            />
          ) : null}
          {section === 'ilhas' ? (
            <IlhaSection
              ilhas={people.ilhas}
              directory={directory}
              selection={selection}
              onSelect={(ilha) => {
                selectItem({ kind: 'ilha', id: ilha.id });
              }}
            />
          ) : null}
        </div>
      </aside>
      <div className="wa-chat admin-detail admin-detail-pane" role="region" aria-label={`Detalhes de ${title}`}>
        {content}
        {feedback?.kind === 'error' ? (
          <div className="session-banner session-banner-error" role="alert">
            <p>{feedback.text}</p>
            <button
              type="button"
              onClick={() => {
                setFeedback(null);
              }}
            >
              Fechar
            </button>
          </div>
        ) : null}
        <div className="admin-status" role="status">
          {feedback?.kind === 'ok' ? feedback.text : ''}
        </div>
      </div>
    </section>
  );
}

function newTitle(section: Section): string {
  switch (section) {
    case 'supervisors':
      return 'Novo supervisor';
    case 'ilhas':
      return 'Nova ilha';
    case 'agents':
      return 'Novo agente';
    case 'log':
      return 'Registro';
    default: {
      const exhaustive: never = section;
      return exhaustive;
    }
  }
}

function PeopleSection({
  title,
  users,
  directory,
  selection,
  empty,
  onSelect,
}: {
  title: string;
  users: readonly StaffUser[];
  directory: Directory;
  selection: Selection | null;
  empty?: string;
  onSelect: (user: StaffUser) => void;
}) {
  const id = useId();
  return (
    <section className="conversation-section" aria-labelledby={id}>
      <h2 id={id} className="conversation-section-title">
        {title}
      </h2>
      {users.length === 0 && empty ? <p className="conversation-empty">{empty}</p> : null}
      <ul className="conversation-list">
        {users.map((user) => {
          const selected = selection?.kind === 'user' && selection.id === user.id;
          const ilha = user.role === 'agent' ? own(directory.ilhas, user.ilhaId)?.name : undefined;
          const detail = [roleLabel(user.role), ilha ? `Ilha ${ilha}` : undefined].filter((part) => part !== undefined).join(' · ');
          return (
            <li key={user.id}>
              <button
                type="button"
                className={`conversation-item${selected ? ' is-active' : ''}`}
                data-item-id={user.id}
                data-testid={`admin-user-${user.id}`}
                {...(selected ? { 'aria-current': 'true' as const } : {})}
                onClick={() => {
                  onSelect(user);
                }}
              >
                <span className="avatar avatar-contact" aria-hidden="true">
                  {conversationInitials(user.name)}
                </span>
                <span className="conversation-copy">
                  <span className="conversation-row">
                    <span className="conversation-title">{user.name}</span>
                    {!user.active ? <span className="admin-badge">Desativado</span> : null}
                  </span>
                  <span className="conversation-row">
                    <span className="conversation-preview">{detail}</span>
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

function IlhaSection({
  ilhas,
  directory,
  selection,
  onSelect,
}: {
  ilhas: readonly Ilha[];
  directory: Directory;
  selection: Selection | null;
  onSelect: (ilha: Ilha) => void;
}) {
  const id = useId();
  return (
    <section className="conversation-section" aria-labelledby={id}>
      <h2 id={id} className="conversation-section-title">
        Ilhas
      </h2>
      {ilhas.length === 0 ? <p className="conversation-empty">Nenhuma ilha criada.</p> : null}
      <ul className="conversation-list">
        {ilhas.map((ilha) => {
          const selected = selection?.kind === 'ilha' && selection.id === ilha.id;
          const supervisor = own(directory.users, ilha.supervisorId)?.name ?? 'sem supervisor';
          const count = Object.values(directory.users).filter((user) => user.role === 'agent' && user.ilhaId === ilha.id).length;
          return (
            <li key={ilha.id}>
              <button
                type="button"
                className={`conversation-item${selected ? ' is-active' : ''}`}
                data-item-id={ilha.id}
                data-testid={`admin-ilha-${ilha.id}`}
                {...(selected ? { 'aria-current': 'true' as const } : {})}
                onClick={() => {
                  onSelect(ilha);
                }}
              >
                <span className="avatar avatar-contact" aria-hidden="true">
                  {conversationInitials(ilha.name)}
                </span>
                <span className="conversation-copy">
                  <span className="conversation-row">
                    <span className="conversation-title">{ilha.name}</span>
                  </span>
                  <span className="conversation-row">
                    <span className="conversation-preview">{`${supervisor} · ${String(count)} ${count === 1 ? 'agente' : 'agentes'}`}</span>
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
