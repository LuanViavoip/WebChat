import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { asConversationId, sortConversations, type ConversationId } from '../domain/conversation';
import type { StaffUser } from '../domain/identity';
import { can } from '../domain/permissions';
import { rejectionMessage, splitCaption, validateFiles, type ValidAttachment } from '../domain/attachment';
import type { ChatMessage } from '../domain/message';
import type { ChatTransport, ConnectRequest, TransportStatus } from '../transport/ChatTransport';
import { DEFAULT_SESSION } from '../transport/mock/seed';
import type { ObjectUrlFactory } from '../transport/objectUrls';
import { AttachmentPreview } from './attachments/AttachmentPreview';
import { ImageViewer } from './attachments/ImageViewer';
import type { OpenImage } from './attachments/MediaBody';
import { useFileDrop } from './attachments/useFileDrop';
import { ChatHeader } from './ChatHeader';
import { historyConversationId, historyPane, mergeHistoryState } from './chatHistory';
import { Composer } from './Composer';
import {
  conversationItem,
  conversationTitle,
  openableColleagues,
  otherParticipant,
  roleLabel,
  type ConversationItem,
} from './conversations';
import { liveActivity, liveActivityAnnouncement } from './liveActivity';
import { MessageList } from './MessageList';
import { Sidebar } from './Sidebar';
import { threadView, useChatSession } from './useChatSession';
import { useMediaQuery } from './useMediaQuery';

type MobilePane = 'list' | 'chat';
type PendingFocus = 'chat' | 'list';

export function ChatPanel({
  transport,
  identity = DEFAULT_SESSION,
  onSwitchUser,
  onOpenAdmin,
  objectUrls,
}: {
  transport: ChatTransport;
  /** Quem entrou. O ChatPanel de outro usuário é outro ChatPanel (`key`): a sessão anterior é parada ao desmontar. */
  identity?: ConnectRequest;
  onSwitchUser?: () => void;
  /** Só é chamado se o usuário tem `admin.console`. */
  onOpenAdmin?: () => void;
  objectUrls?: ObjectUrlFactory;
}) {
  const isMobile = useMediaQuery('(max-width: 900px)');
  const [mobilePane, setMobilePane] = useState<MobilePane>(() => historyPane(window.history.state));
  const [chosenId, setChosenId] = useState<ConversationId | null>(() => {
    const fromHistory = historyConversationId(window.history.state);
    return fromHistory ? asConversationId(fromHistory) : null;
  });
  const [drafts, setDrafts] = useState<Readonly<Record<string, string>>>({});
  const [pendingAttachment, setPendingAttachment] = useState<ValidAttachment | null>(null);
  const [attachError, setAttachError] = useState<string | null>(null);
  const [viewer, setViewer] = useState<OpenImage | null>(null);
  const viewerOpener = useRef<HTMLElement | null>(null);
  const chatRef = useRef<HTMLDivElement>(null);
  const shellRef = useRef<HTMLElement>(null);
  const { session, state: full } = useChatSession(
    transport,
    identity,
    objectUrls ? { objectUrls } : undefined,
  );
  const { me, directory } = full;
  const sorted = useMemo(
    () => (me && directory ? sortConversations(full.summaries, me, directory) : { priority: [], colleagues: [] }),
    [full.summaries, me, directory],
  );
  const firstId = sorted.priority[0]?.id ?? sorted.colleagues[0]?.id ?? null;
  const selectedId: ConversationId | null =
    chosenId && full.conversations[chosenId] ? chosenId : firstId;
  const chatVisible = !isMobile || mobilePane === 'chat';
  const state = threadView(full, selectedId);
  const selectedThread = selectedId ? full.conversations[selectedId] : undefined;
  const messages = state.messages;
  const typing = state.typing;
  const disabled = state.connection !== 'connected' || selectedId === null;
  const draft = selectedId ? (drafts[selectedId] ?? '') : '';
  const showBack = isMobile && mobilePane === 'chat';
  const hadConnected = useRef(false);
  const unreadBaseline = useRef(0);
  const unreadBaselineReady = useRef(false);
  const totalUnread = full.summaries.reduce((sum, item) => sum + item.unread, 0);
  const unreadElsewhere = full.summaries.some((item) => item.id !== selectedId && item.unread > 0);
  const unseenWhileHidden = !chatVisible && unreadBaselineReady.current && totalUnread > unreadBaseline.current;

  function activityOf(id: ConversationId): ReturnType<typeof liveActivity> {
    const thread = full.conversations[id];
    const isSelected = id === selectedId;
    const ownError =
      full.error !== null && (full.errorConversationId === id || (full.errorConversationId === null && isSelected));
    return liveActivity({
      error: ownError ? full.error : null,
      connection: isSelected ? full.connection : 'connected',
      typing: thread?.typing ?? { isTyping: false },
      messages: thread?.messages ?? [],
      hadConnected: hadConnected.current,
      failedUpload: Object.values(thread?.uploads ?? {}).some((upload) => upload.phase === 'failed'),
    });
  }

  const sections = (() => {
    if (!me || !directory) {
      return { priority: [] as ConversationItem[], colleagues: [] as ConversationItem[] };
    }
    const now = new Date();
    const build = (items: typeof sorted.priority) =>
      items.map((summary) => conversationItem(summary, me, directory, activityOf(summary.id), now));
    return { priority: build(sorted.priority), colleagues: build(sorted.colleagues) };
  })();

  const announcement = liveActivityAnnouncement(
    selectedId
      ? liveActivity({
          error: state.error,
          connection: state.connection,
          typing: state.typing,
          messages: state.messages,
          unseen: unseenWhileHidden,
          hadConnected: hadConnected.current,
          failedUpload: Object.values(state.uploads).some((upload) => upload.phase === 'failed'),
        })
      : 'idle',
    chatVisible,
  );
  const pendingFocus = useRef<PendingFocus | null>(null);
  const isMobileRef = useRef(isMobile);
  const historyReady = useRef(false);
  isMobileRef.current = isMobile;

  const newConversationCandidates = useMemo(
    () => (me && directory ? openableColleagues(me, directory) : []),
    [me, directory],
  );
  const adminAllowed = Boolean(me && directory && can(me, { type: 'admin.console' }, directory).ok);

  const handleFiles = useCallback((files: File[]) => {
    const check = validateFiles(files);
    if (!check) {
      return;
    }
    if (!check.ok) {
      setAttachError(rejectionMessage(check.rejection));
      return;
    }
    setAttachError(null);
    setPendingAttachment(check.attachment);
  }, []);

  const { dragging } = useFileDrop(chatRef, {
    enabled: !disabled && !pendingAttachment,
    onFiles: handleFiles,
    surface: shellRef,
  });
  const selectedIdRef = useRef(selectedId);
  selectedIdRef.current = selectedId;

  // A conversa à vista é a ativa na sessão (marca como lida); com a lista à frente (mobile) nenhuma é.
  useEffect(() => {
    session.selectConversation(chatVisible ? selectedId : null);
  }, [session, selectedId, chatVisible, me]);

  useEffect(() => {
    if (!historyReady.current && selectedId) {
      historyReady.current = true;
      writeHistory(mobilePane, selectedId, 'replace');
    }
    function onPop(event: PopStateEvent) {
      const pane = historyPane(event.state);
      const conversationId = historyConversationId(event.state);
      if (conversationId) {
        assignConversation(asConversationId(conversationId));
      }
      setMobilePane(pane);
      if (isMobileRef.current) {
        pendingFocus.current = pane === 'chat' ? 'chat' : 'list';
      }
    }
    window.addEventListener('popstate', onPop);
    return () => {
      window.removeEventListener('popstate', onPop);
    };
  }, [mobilePane, selectedId]);

  useEffect(() => {
    const target = pendingFocus.current;
    if (!target) {
      return;
    }
    pendingFocus.current = null;
    if (target === 'chat') {
      document.querySelector<HTMLElement>('.chat-header')?.focus();
      return;
    }
    const origin = selectedId
      ? document.querySelector<HTMLElement>(`[data-conversation-id="${CSS.escape(selectedId)}"]`)
      : null;
    if (origin) {
      origin.focus();
      return;
    }
    document.querySelector<HTMLElement>('.sidebar-search input')?.focus();
  }, [mobilePane, selectedId]);

  useEffect(() => {
    if (state.connection === 'connected') {
      hadConnected.current = true;
    }
  }, [state.connection]);

  useEffect(() => {
    if (chatVisible || (!unreadBaselineReady.current && me)) {
      unreadBaseline.current = totalUnread;
      unreadBaselineReady.current = Boolean(me);
    }
  }, [chatVisible, totalUnread, me]);

  function assignConversation(id: ConversationId) {
    if (id !== selectedIdRef.current) {
      setPendingAttachment(null);
      setAttachError(null);
      setViewer(null);
    }
    setChosenId(id);
  }

  function selectConversation(id: ConversationId) {
    assignConversation(id);
    const nextPane: MobilePane = isMobile ? 'chat' : mobilePane;
    setMobilePane(nextPane);
    const currentPane = historyPane(window.history.state);
    const currentId = historyConversationId(window.history.state);
    if (isMobile && currentPane === 'list' && nextPane === 'chat') {
      writeHistory('list', id, 'replace');
      writeHistory('chat', id, 'push');
    } else if (currentPane !== nextPane || currentId !== id) {
      writeHistory(nextPane, id, 'push');
    }
    if (isMobile) {
      pendingFocus.current = 'chat';
    }
  }

  async function openDirect(user: StaffUser) {
    const id = await session.openDirect(user.id);
    if (id) {
      selectConversation(id);
    }
  }

  function setDraft(value: string) {
    if (selectedId) {
      setDrafts((current) => ({ ...current, [selectedId]: value }));
    }
  }

  function send(text: string) {
    if (selectedId) {
      void session.send(selectedId, text);
    }
  }

  function retry(messageId: string) {
    if (selectedId) {
      void session.retry(selectedId, messageId);
    }
  }

  function reconnect() {
    void session.reconnect();
  }

  function sendAttachment(attachment: ValidAttachment, caption?: string) {
    if (selectedId) {
      void session.sendAttachment(selectedId, attachment, caption);
    }
  }

  function cancelUpload(messageId: string) {
    if (selectedId) {
      session.cancelUpload(selectedId, messageId);
    }
  }

  function focusAttachControl() {
    requestAnimationFrame(() => {
      document.querySelector<HTMLElement>('[aria-label="Anexar arquivo"]')?.focus();
    });
  }

  function closePreview() {
    setPendingAttachment(null);
    focusAttachControl();
  }

  function handleCancelUpload(id: string) {
    cancelUpload(id);
    focusAttachControl();
  }

  const restoreViewerFocus = useCallback((opener: HTMLElement | null) => {
    requestAnimationFrame(() => {
      if (opener?.isConnected) {
        opener.focus();
        return;
      }
      const attach = document.querySelector<HTMLButtonElement>('[aria-label="Anexar arquivo"]');
      if (attach && !attach.disabled) {
        attach.focus();
        return;
      }
      const field = document.querySelector<HTMLTextAreaElement>('[aria-label="Mensagem"]');
      if (field && !field.disabled) {
        field.focus();
        return;
      }
      document.querySelector<HTMLElement>('.chat-header')?.focus();
    });
  }, []);

  const closeViewer = useCallback(() => {
    const opener = viewerOpener.current;
    setViewer(null);
    restoreViewerFocus(opener);
  }, [restoreViewerFocus]);

  function backToList() {
    if (isMobile && historyPane(window.history.state) === 'chat') {
      window.history.back();
      return;
    }
    setMobilePane('list');
    if (isMobile) {
      pendingFocus.current = 'list';
    }
  }

  const openImage = resolveOpenImage(viewer, messages);
  const restoreFocusAfterGone = useRef(false);
  if (viewer && !openImage) {
    restoreFocusAfterGone.current = true;
    setViewer(null);
  }

  useLayoutEffect(() => {
    if (!restoreFocusAfterGone.current) {
      return;
    }
    restoreFocusAfterGone.current = false;
    restoreViewerFocus(viewerOpener.current);
  }, [openImage, restoreViewerFocus]);

  const emptyThread = messages.length === 0 && !typing.isTyping;
  const other = selectedThread && me && directory ? otherParticipant(selectedThread.conversation, me, directory) : undefined;
  const title = selectedThread && me && directory ? conversationTitle(selectedThread.conversation, me, directory) : '';
  const note = connectionNote(full.connection, hadConnected.current);
  const banners = (
    <>
      {attachError ? (
        <div className="session-banner session-banner-error" role="alert">
          <p>{attachError}</p>
          <button
            type="button"
            onClick={() => {
              setAttachError(null);
            }}
          >
            Fechar
          </button>
        </div>
      ) : null}
      {state.error ? (
        <div className="session-banner session-banner-error" role="alert">
          <p>{state.error}</p>
          <button type="button" onClick={reconnect}>
            Reconectar
          </button>
        </div>
      ) : null}
    </>
  );

  return (
    <section ref={shellRef} className="wa-shell" data-mobile-pane={mobilePane} aria-label="Conversa">
      <div className="sr-only" aria-live="polite" aria-atomic="true" data-live-announcer>
        {announcement}
      </div>
      <Sidebar
        me={me}
        tenantName={full.tenant?.name ?? ''}
        sections={sections}
        selectedConversationId={selectedId}
        note={note}
        newConversationCandidates={newConversationCandidates}
        onSelect={selectConversation}
        onOpenDirect={(user) => {
          void openDirect(user);
        }}
        onSwitchUser={() => {
          onSwitchUser?.();
        }}
        {...(adminAllowed && onOpenAdmin ? { onOpenAdmin } : {})}
      />
      <div className="wa-chat" ref={chatRef}>
        {selectedId ? (
          <>
            <ChatHeader
              title={title}
              {...(other ? { roleText: roleLabel(other.role) } : {})}
              connection={state.connection}
              typing={typing}
              unseenLive={unreadElsewhere}
              {...(showBack ? { onBack: backToList } : {})}
            />
            <MessageList
              messages={messages}
              selfId={identity.userId}
              typing={typing}
              onRetry={retry}
              empty={emptyThread}
              hidden={Boolean(pendingAttachment)}
              uploads={state.uploads}
              onCancelUpload={handleCancelUpload}
              onOpenImage={(image, opener) => {
                viewerOpener.current = opener;
                setViewer(image);
              }}
            />
          </>
        ) : (
          <div className="chat-empty-state">
            <p>Selecione uma conversa para começar.</p>
          </div>
        )}
        {dragging ? (
          <div className="drop-overlay" aria-hidden="true">
            Solte o arquivo para anexar
          </div>
        ) : null}
        {banners}
        {selectedId && pendingAttachment ? (
          <AttachmentPreview
            attachment={pendingAttachment}
            initialCaption={draft}
            disabled={disabled}
            onCancel={() => {
              closePreview();
            }}
            onSend={(caption) => {
              const kind = pendingAttachment.kind;
              sendAttachment(pendingAttachment, caption);
              if (kind === 'image' || kind === 'video') {
                setDraft(splitCaption(draft).rest);
              }
              closePreview();
            }}
          />
        ) : selectedId ? (
          <Composer
            value={draft}
            onChange={setDraft}
            onSend={send}
            disabled={disabled}
            onPickFiles={handleFiles}
          />
        ) : null}
        <ImageViewer image={openImage} onClose={closeViewer} />
      </div>
    </section>
  );
}

function connectionNote(connection: TransportStatus, hadConnected: boolean): string {
  switch (connection) {
    case 'connecting':
      return hadConnected ? 'Reconectando…' : 'Conectando…';
    case 'error':
      return 'Não foi possível carregar as conversas.';
    case 'connected':
    case 'disconnected':
      return '';
    default: {
      const exhaustive: never = connection;
      return exhaustive;
    }
  }
}

function resolveOpenImage(
  viewer: OpenImage | null,
  messages: ChatMessage[],
): { url: string; alt: string; fileName: string } | null {
  if (!viewer) {
    return null;
  }
  const message = messages.find((item) => item.id === viewer.messageId);
  if (!message || message.type !== 'image') {
    return null;
  }
  return { url: message.url, alt: message.caption || viewer.alt, fileName: viewer.fileName };
}

function writeHistory(pane: MobilePane, conversationId: string, mode: 'push' | 'replace') {
  const next = mergeHistoryState(window.history.state, { smPane: pane, conversationId });
  if (mode === 'push') {
    window.history.pushState(next, '');
    return;
  }
  window.history.replaceState(next, '');
}
