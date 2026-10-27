import {
  conversationAckSchema,
  conversationCloseAckSchema,
  conversationListAckSchema,
  conversationSummarySchema,
  historySyncAckSchema,
  messageReadAckSchema,
  messageReadSchema,
  messageRecordSchema,
  messageSendAckSchema,
  type AuthMe,
  type ConversationEvent,
  type ConversationSummary,
  type MessageRecord,
  type PresenceStatus,
} from '@viavoip/protocol';
import { useEffect, useRef, useState } from 'react';
import type { Socket } from 'socket.io-client';
import { ConversationPane } from './ConversationPane.js';
import { DetailColumn } from './DetailColumn.js';
import { QueueColumn } from './QueueColumn.js';
import {
  latestMessageId,
  mergeMessages,
  storeMessage,
  upsertConversation,
  type MessageBuckets,
  type ReadCursors,
} from './state.js';

type Pane = 'queues' | 'thread' | 'details';
export type LinkState = 'connected' | 'reconnecting' | 'disconnected';
type Notice = { tone: 'ok' | 'error'; text: string };

export function Desk({
  profile,
  socket,
  link,
  selfStatus,
}: {
  profile: AuthMe;
  socket: Socket | null;
  link: LinkState;
  selfStatus: PresenceStatus;
}) {
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [messages, setMessages] = useState<MessageBuckets>({});
  const [events, setEvents] = useState<Record<string, ConversationEvent[]>>({});
  const [cursors, setCursors] = useState<ReadCursors>({});
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [queueId, setQueueId] = useState(profile.queues[0]?.id ?? '');
  const [dispositionId, setDispositionId] = useState('');
  const [notice, setNotice] = useState<Notice | null>(null);
  const [pane, setPane] = useState<Pane>('queues');
  const [now, setNow] = useState(() => Date.now());
  const selectedRef = useRef<string | null>(null);
  const cursorsRef = useRef<Map<string, { afterMessageId?: string; afterEventId?: string }>>(new Map());
  const profileRef = useRef(profile);
  selectedRef.current = selectedId;
  profileRef.current = profile;
  const selected = conversations.find((conversation) => conversation.id === selectedId) ?? null;
  const selectedMessages = selectedId ? messages[selectedId] ?? [] : [];
  const owns = selected?.agentId === profile.selfId && selected.status === 'assigned';
  const atCapacity = conversations.filter(
    (conversation) => conversation.agentId === profile.selfId && conversation.status === 'assigned',
  ).length >= profile.maxConcurrentAssignments;
  const canClaim = profile.role === 'agent'
    && selected?.status === 'queued'
    && selfStatus === 'available'
    && !atCapacity;

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!socket) return;
    const subscribe = () => {
      const event = profileRef.current.role === 'agent' ? 'queue.subscribe' : 'conversation.list';
      socket.emit(event, {}, (ack: unknown) => {
        const parsed = conversationListAckSchema.safeParse(ack);
        if (!parsed.success || !parsed.data.ok) return;
        setConversations(parsed.data.conversations);
        for (const conversation of parsed.data.conversations) {
          const cursor = cursorsRef.current.get(conversation.id);
          syncOne(socket, conversation.id, cursor);
        }
      });
    };
    const onConversation = (payload: unknown) => {
      const parsed = conversationSummarySchema.safeParse(payload);
      if (!parsed.success) return;
      setConversations((current) => upsertConversation(current, parsed.data));
    };
    const onMessage = (payload: unknown) => {
      const parsed = messageRecordSchema.safeParse(payload);
      if (!parsed.success) return;
      setMessages((current) => storeMessage(current, parsed.data));
      rememberMessage(cursorsRef.current, parsed.data);
      if (parsed.data.conversationId === selectedRef.current && profileRef.current.role === 'agent') {
        markLatest(socket, parsed.data.conversationId, parsed.data.id, setCursors);
      }
    };
    const onRead = (payload: unknown) => {
      const parsed = messageReadSchema.safeParse(payload);
      if (!parsed.success || parsed.data.agentId !== profileRef.current.selfId) return;
      setCursors((current) => ({ ...current, [parsed.data.conversationId]: parsed.data.messageId }));
    };
    socket.on('connect', subscribe);
    socket.on('conversation.updated', onConversation);
    socket.on('message.new', onMessage);
    socket.on('message.read', onRead);
    if (socket.connected) subscribe();
    return () => {
      socket.off('connect', subscribe);
      socket.off('conversation.updated', onConversation);
      socket.off('message.new', onMessage);
      socket.off('message.read', onRead);
    };
  }, [socket]);

  useEffect(() => {
    if (!socket || !selectedId) return;
    const cursor = cursorsRef.current.get(selectedId);
    syncOne(socket, selectedId, cursor);
  }, [selectedId, socket]);

  function selectConversation(conversationId: string) {
    setSelectedId(conversationId);
    setPane('thread');
    setNotice(null);
    const latest = latestMessageId(messages[conversationId]);
    if (latest && socket && profile.role === 'agent') markLatest(socket, conversationId, latest, setCursors);
  }

  async function claim() {
    if (!socket || !selected) return;
    const parsed = conversationAckSchema.safeParse(
      await emit(socket, 'conversation.claim', { conversationId: selected.id }),
    );
    if (!parsed.success || !parsed.data.ok) {
      setNotice({ tone: 'error', text: ackError(parsed, 'Não foi possível assumir') });
      return;
    }
    const conversation = parsed.data.conversation;
    setConversations((current) => upsertConversation(current, conversation));
    setNotice({ tone: 'ok', text: 'Atendimento assumido' });
  }

  async function send() {
    if (!socket || !selected) return;
    const body = draft.trim();
    if (!body) return;
    const requestId = crypto.randomUUID();
    setDraft('');
    const parsed = messageSendAckSchema.safeParse(
      await emit(socket, 'message.send', { conversationId: selected.id, requestId, body }),
    );
    if (!parsed.success || !parsed.data.ok) {
      setDraft(body);
      setNotice({ tone: 'error', text: ackError(parsed, 'Mensagem recusada') });
      return;
    }
    setNotice(null);
  }

  async function release() {
    if (!socket || !selected) return;
    const parsed = conversationAckSchema.safeParse(
      await emit(socket, 'conversation.release', { conversationId: selected.id }),
    );
    if (!parsed.success || !parsed.data.ok) {
      setNotice({ tone: 'error', text: ackError(parsed, 'Não foi possível devolver') });
      return;
    }
    const conversation = parsed.data.conversation;
    setConversations((current) => upsertConversation(current, conversation));
    setNotice({ tone: 'ok', text: 'Contato devolvido à fila' });
  }

  async function transfer() {
    if (!socket || !selected || !queueId) return;
    const parsed = conversationAckSchema.safeParse(
      await emit(socket, 'conversation.transfer', { conversationId: selected.id, queueId }),
    );
    if (!parsed.success || !parsed.data.ok) {
      setNotice({ tone: 'error', text: ackError(parsed, 'Transferência recusada') });
      return;
    }
    const conversation = parsed.data.conversation;
    setConversations((current) => upsertConversation(current, conversation));
    setNotice({ tone: 'ok', text: 'Atendimento transferido' });
  }

  async function closeConversation() {
    if (!socket || !selected || !dispositionId) return;
    const parsed = conversationCloseAckSchema.safeParse(
      await emit(socket, 'conversation.close', { conversationId: selected.id, dispositionId }),
    );
    if (!parsed.success || !parsed.data.ok) {
      setNotice({ tone: 'error', text: ackError(parsed, 'Não foi possível encerrar') });
      return;
    }
    const conversation = parsed.data.conversation;
    setConversations((current) => upsertConversation(current, conversation));
    setDispositionId('');
    setNotice({ tone: 'ok', text: 'Atendimento encerrado. O visitante recebeu a pesquisa.' });
  }

  function syncOne(
    current: Socket,
    conversationId: string,
    cursor: { afterMessageId?: string; afterEventId?: string } | undefined,
  ) {
    current.emit(
      'history.sync',
      {
        conversationId,
        ...(cursor?.afterMessageId ? { afterMessageId: cursor.afterMessageId } : {}),
        ...(cursor?.afterEventId ? { afterEventId: cursor.afterEventId } : {}),
      },
      (ack: unknown) => {
        const parsed = historySyncAckSchema.safeParse(ack);
        if (!parsed.success || !parsed.data.ok) return;
        const data = parsed.data;
        rememberCursor(cursorsRef.current, conversationId, data.messages, data.events);
        setMessages((buckets) => ({
          ...buckets,
          [conversationId]: mergeMessages(buckets[conversationId], data.messages),
        }));
        setEvents((currentEvents) => ({
          ...currentEvents,
          [conversationId]: mergeEvents(currentEvents[conversationId], data.events),
        }));
        if (data.lastReadMessageId) {
          setCursors((currentCursors) => ({ ...currentCursors, [conversationId]: data.lastReadMessageId ?? undefined }));
        }
        setConversations((currentConversations) => upsertConversation(currentConversations, data.conversation));
      },
    );
  }

  const canTransfer = profile.role === 'supervisor' || profile.role === 'admin' || owns;

  return (
    <div className="desk-view">
      <nav className="pane-switch" aria-label="Seções da central">
        <button type="button" aria-pressed={pane === 'queues'} onClick={() => setPane('queues')}>Filas</button>
        <button type="button" aria-pressed={pane === 'thread'} onClick={() => setPane('thread')}>Conversa</button>
        <button type="button" aria-pressed={pane === 'details'} onClick={() => setPane('details')}>Detalhes</button>
      </nav>
      {notice ? <p className={notice.tone === 'error' ? 'error' : 'ok'} role="status" data-testid="notice">{notice.text}</p> : null}
      {link === 'disconnected' && conversations.length === 0 ? <p className="muted">Conectando à central…</p> : null}
      <div className="desk-grid">
        <QueueColumn
          queues={profile.queues}
          conversations={conversations}
          messages={messages}
          cursors={cursors}
          selectedId={selectedId}
          selfId={profile.selfId}
          now={now}
          active={pane === 'queues'}
          onSelect={selectConversation}
        />
        <ConversationPane
          conversation={selected}
          messages={selectedMessages}
          draft={draft}
          link={link}
          canReply={owns}
          canClaim={canClaim}
          loading={link === 'disconnected' && conversations.length === 0}
          active={pane === 'thread'}
          onDraft={setDraft}
          onSend={() => void send()}
          onClaim={() => void claim()}
          onOpenDetails={() => setPane('details')}
        />
        <DetailColumn
          conversation={selected}
          events={selectedId ? events[selectedId] ?? [] : []}
          queues={profile.queues}
          dispositions={profile.dispositions}
          queueId={queueId}
          dispositionId={dispositionId}
          now={now}
          owns={owns}
          canTransfer={canTransfer}
          selfStatus={selfStatus}
          active={pane === 'details'}
          onQueue={setQueueId}
          onDisposition={setDispositionId}
          onRelease={() => void release()}
          onTransfer={() => void transfer()}
          onClose={() => void closeConversation()}
        />
      </div>
    </div>
  );
}

function markLatest(
  socket: Socket,
  conversationId: string,
  messageId: string,
  setCursors: (update: (current: ReadCursors) => ReadCursors) => void,
) {
  socket.emit('message.read', { conversationId, messageId }, (ack: unknown) => {
    const parsed = messageReadAckSchema.safeParse(ack);
    if (!parsed.success || !parsed.data.ok || !parsed.data.advanced) return;
    setCursors((current) => ({ ...current, [conversationId]: messageId }));
  });
}

function rememberCursor(
  cursors: Map<string, { afterMessageId?: string; afterEventId?: string }>,
  conversationId: string,
  messages: MessageRecord[],
  events: { id: string }[],
) {
  const previous = cursors.get(conversationId);
  const afterMessageId = messages.at(-1)?.id ?? previous?.afterMessageId;
  const afterEventId = events.at(-1)?.id ?? previous?.afterEventId;
  cursors.set(conversationId, {
    ...(afterMessageId ? { afterMessageId } : {}),
    ...(afterEventId ? { afterEventId } : {}),
  });
}

function rememberMessage(
  cursors: Map<string, { afterMessageId?: string; afterEventId?: string }>,
  message: MessageRecord,
) {
  const previous = cursors.get(message.conversationId);
  cursors.set(message.conversationId, {
    afterMessageId: message.id,
    ...(previous?.afterEventId ? { afterEventId: previous.afterEventId } : {}),
  });
}

function mergeEvents(current: ConversationEvent[] | undefined, extra: ConversationEvent[]): ConversationEvent[] {
  const byId = new Map<string, ConversationEvent>();
  for (const event of [...(current ?? []), ...extra]) byId.set(event.id, event);
  return [...byId.values()].sort(
    (left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id),
  );
}

function ackError(parsed: { success: boolean; data?: unknown }, fallback: string): string {
  if (!parsed.success || !parsed.data || typeof parsed.data !== 'object') return fallback;
  if (!('ok' in parsed.data) || parsed.data.ok !== false) return fallback;
  if (!('error' in parsed.data) || !parsed.data.error || typeof parsed.data.error !== 'object') return fallback;
  if (!('message' in parsed.data.error) || typeof parsed.data.error.message !== 'string') return fallback;
  return parsed.data.error.message;
}

function emit(socket: Socket, event: string, payload: unknown): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), 8000);
    socket.emit(event, payload, (response: unknown) => {
      clearTimeout(timer);
      resolve(response);
    });
  });
}
