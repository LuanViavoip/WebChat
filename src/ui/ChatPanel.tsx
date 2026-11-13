import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { rejectionMessage, splitCaption, validateFiles, type ValidAttachment } from '../domain/attachment';
import type { ChatMessage } from '../domain/message';
import { previewOf } from '../domain/message';
import type { ChatTransport } from '../transport/ChatTransport';
import type { ObjectUrlFactory } from '../transport/objectUrls';
import { AttachmentPreview } from './attachments/AttachmentPreview';
import { ImageViewer } from './attachments/ImageViewer';
import type { OpenImage } from './attachments/MediaBody';
import { useFileDrop } from './attachments/useFileDrop';
import { ChatHeader } from './ChatHeader';
import { historyConversationId, historyPane, mergeHistoryState } from './chatHistory';
import { Composer } from './Composer';
import {
  CLIENT_CONVERSATIONS,
  conversationById,
  isLiveConversation,
  LIVE_CONVERSATION_ID,
} from './conversations';
import { liveActivity, liveActivityAnnouncement } from './liveActivity';
import { MessageList } from './MessageList';
import { Sidebar } from './Sidebar';
import { useChatSession } from './useChatSession';
import { useMediaQuery } from './useMediaQuery';

type MobilePane = 'list' | 'chat';
type PendingFocus = 'chat' | 'list';

function resolveConversationId(id: string | undefined): string {
  if (id && CLIENT_CONVERSATIONS.some((item) => item.id === id)) {
    return id;
  }
  return LIVE_CONVERSATION_ID;
}

export function ChatPanel({
  transport,
  selectedConversationId: selectedConversationIdProp,
  onSelectConversation,
  objectUrls,
}: {
  transport: ChatTransport;
  selectedConversationId?: string;
  onSelectConversation?: (id: string) => void;
  objectUrls?: ObjectUrlFactory;
}) {
  const { state, send, retry, reconnect, sendAttachment, cancelUpload } = useChatSession(
    transport,
    objectUrls ? { objectUrls } : undefined,
  );
  const isMobile = useMediaQuery('(max-width: 900px)');
  const [mobilePane, setMobilePane] = useState<MobilePane>(() => historyPane(window.history.state));
  const [uncontrolledId, setUncontrolledId] = useState(
    () => resolveConversationId(historyConversationId(window.history.state)),
  );
  const [draft, setDraft] = useState('');
  const [pendingAttachment, setPendingAttachment] = useState<ValidAttachment | null>(null);
  const [attachError, setAttachError] = useState<string | null>(null);
  const [viewer, setViewer] = useState<OpenImage | null>(null);
  const viewerOpener = useRef<HTMLElement | null>(null);
  const chatRef = useRef<HTMLDivElement>(null);
  const shellRef = useRef<HTMLElement>(null);
  const controlled = selectedConversationIdProp !== undefined;
  const selectedConversationId = resolveConversationId(selectedConversationIdProp ?? uncontrolledId);
  const live = isLiveConversation(selectedConversationId);
  const liveVisible = live && (!isMobile || mobilePane === 'chat');
  const conversation = conversationById(selectedConversationId);
  const messages = live ? state.messages : conversation.transcript;
  const typing = live ? state.typing : { isTyping: false, actorName: '' };
  const disabled = state.connection !== 'connected';
  const preview = lastPreview(state.messages);
  const showBack = isMobile && mobilePane === 'chat';
  const hadConnected = useRef(false);
  const seenLiveCount = useRef(0);
  const unseenBaselineReady = useRef(false);
  const unseenLive =
    !liveVisible &&
    unseenBaselineReady.current &&
    state.messages.slice(seenLiveCount.current).some((message) => message.direction !== 'client');
  const activity = liveActivity({
    error: state.error,
    connection: state.connection,
    typing: state.typing,
    messages: state.messages,
    unseen: unseenLive,
    hadConnected: hadConnected.current,
    failedUpload: Object.values(state.uploads).some((upload) => upload.phase === 'failed'),
  });
  const announcement = liveActivityAnnouncement(activity, liveVisible);
  const pendingFocus = useRef<PendingFocus | null>(null);
  const isMobileRef = useRef(isMobile);
  const onSelectRef = useRef(onSelectConversation);
  const controlledRef = useRef(controlled);
  const historyReady = useRef(false);
  isMobileRef.current = isMobile;
  onSelectRef.current = onSelectConversation;
  controlledRef.current = controlled;

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
    enabled: live && !disabled && !pendingAttachment,
    onFiles: handleFiles,
    surface: shellRef,
  });
  const selectedIdRef = useRef(selectedConversationId);
  selectedIdRef.current = selectedConversationId;

  useEffect(() => {
    if (!historyReady.current) {
      historyReady.current = true;
      writeHistory(mobilePane, selectedConversationId, 'replace');
    }
    function onPop(event: PopStateEvent) {
      const pane = historyPane(event.state);
      const conversationId = historyConversationId(event.state);
      if (conversationId) {
        assignConversation(resolveConversationId(conversationId));
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
  }, [mobilePane, selectedConversationId]);

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
    const origin = document.querySelector<HTMLElement>(
      `[data-conversation-id="${CSS.escape(selectedConversationId)}"]`,
    );
    if (origin) {
      origin.focus();
      return;
    }
    document.querySelector<HTMLElement>('.sidebar-search input')?.focus();
  }, [mobilePane, selectedConversationId]);

  useEffect(() => {
    if (state.connection === 'connected') {
      hadConnected.current = true;
    }
  }, [state.connection]);

  useEffect(() => {
    if (liveVisible) {
      seenLiveCount.current = state.messages.length;
      unseenBaselineReady.current = true;
      return;
    }
    if (!unseenBaselineReady.current && (state.connection === 'connected' || state.connection === 'error')) {
      seenLiveCount.current = state.messages.length;
      unseenBaselineReady.current = true;
    }
  }, [liveVisible, state.messages.length, state.connection]);

  function assignConversation(id: string) {
    const nextId = resolveConversationId(id);
    if (nextId !== selectedIdRef.current) {
      setPendingAttachment(null);
      setAttachError(null);
      setViewer(null);
    }
    if (!controlledRef.current) {
      setUncontrolledId(nextId);
    }
    onSelectRef.current?.(nextId);
  }

  function selectConversation(id: string) {
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

  return (
    <section ref={shellRef} className="wa-shell" data-mobile-pane={mobilePane} aria-label="Conversa">
      <div className="sr-only" aria-live="polite" aria-atomic="true" data-live-announcer>
        {announcement}
      </div>
      <Sidebar
        preview={preview}
        selectedConversationId={selectedConversationId}
        liveActivity={activity}
        onSelect={selectConversation}
      />
      <div className="wa-chat" ref={chatRef}>
        <ChatHeader
          title={conversation.title}
          connection={state.connection}
          typing={typing}
          unseenLive={unseenLive}
          {...(showBack ? { onBack: backToList } : {})}
        />
        <MessageList
          messages={messages}
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
        {dragging ? (
          <div className="drop-overlay" aria-hidden="true">
            Solte o arquivo para anexar
          </div>
        ) : null}
        {live && attachError ? (
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
        {live && state.error ? (
          <div className="session-banner session-banner-error" role="alert">
            <p>{state.error}</p>
            <button type="button" onClick={reconnect}>
              Reconectar
            </button>
          </div>
        ) : null}
        {live && pendingAttachment ? (
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
        ) : live ? (
          <Composer value={draft} onChange={setDraft} onSend={send} disabled={disabled} onPickFiles={handleFiles} />
        ) : (
          <div className="session-banner">
            <p>Nenhuma conversa selecionada</p>
          </div>
        )}
        <ImageViewer image={openImage} onClose={closeViewer} />
      </div>
    </section>
  );
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

function lastPreview(messages: ChatMessage[]): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!message) {
      continue;
    }
    const line = previewOf(message).split('\n')[0]?.trim();
    if (line) {
      return line.length > 42 ? `${line.slice(0, 41)}…` : line;
    }
  }
  return 'Nenhuma mensagem ainda';
}
