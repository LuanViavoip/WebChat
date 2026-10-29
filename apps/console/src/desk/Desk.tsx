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
import { ackMessage, emitAck, type LinkState } from '../realtime.js';
import { ConfirmDialog, Drawer } from '../ui/Dialog.js';
import { useElementWidth, useNow } from '../ui/hooks.js';
import { useToast } from '../ui/Toast.js';
import { ConversationPane } from './ConversationPane.js';
import { DetailColumn } from './DetailColumn.js';
import { deskLayout, type DeskLayout } from './layout.js';
import { QueueColumn } from './QueueColumn.js';
import {
  latestMessageId,
  mergeMessages,
  storeMessage,
  upsertConversation,
  type MessageBuckets,
  type ReadCursors,
} from './state.js';

type Screen = 'queues' | 'thread';
type Confirmation = 'release' | 'close';

export function Desk({
  profile,
  socket,
  link,
  selfStatus,
}: {
  profile: AuthMe;
  socket: Socket | null;
  link: LinkState;
  selfStatus: PresenceStatus | null;
}) {
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [messages, setMessages] = useState<MessageBuckets>({});
  const [events, setEvents] = useState<Record<string, ConversationEvent[]>>({});
  const [cursors, setCursors] = useState<ReadCursors>({});
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [queueId, setQueueId] = useState(profile.queues[0]?.id ?? '');
  const [dispositionId, setDispositionId] = useState('');
  const [screen, setScreen] = useState<Screen>('queues');
  const [layout, setLayout] = useState<DeskLayout>('wide');
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [confirming, setConfirming] = useState<Confirmation | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const width = useElementWidth(rootRef);
  const now = useNow();
  const toast = useToast();
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

  // Largura 0 = central oculta (outra seção aberta): mantém o último layout conhecido.
  useEffect(() => {
    if (width > 0) setLayout(deskLayout(width));
  }, [width]);

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
      setConversations((current) => upsertConversation(current, parsed.data, profileRef.current.role !== 'agent'));
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
    const refreshSupervisorList = () => {
      if (profileRef.current.role === 'agent') return;
      socket.emit('conversation.list', {}, (ack: unknown) => {
        const parsed = conversationListAckSchema.safeParse(ack);
        if (parsed.success && parsed.data.ok) setConversations(parsed.data.conversations);
      });
    };
    socket.on('connect', subscribe);
    socket.on('conversation.updated', onConversation);
    socket.on('message.new', onMessage);
    socket.on('message.read', onRead);
    socket.on('supervisor.metrics', refreshSupervisorList);
    if (socket.connected) subscribe();
    return () => {
      socket.off('connect', subscribe);
      socket.off('conversation.updated', onConversation);
      socket.off('message.new', onMessage);
      socket.off('message.read', onRead);
      socket.off('supervisor.metrics', refreshSupervisorList);
    };
  }, [socket]);

  useEffect(() => {
    if (!socket || !selectedId) return;
    const cursor = cursorsRef.current.get(selectedId);
    syncOne(socket, selectedId, cursor);
  }, [selectedId, socket]);

  function selectConversation(conversationId: string) {
    setSelectedId(conversationId);
    setScreen('thread');
    const latest = latestMessageId(messages[conversationId]);
    if (latest && socket && profile.role === 'agent') markLatest(socket, conversationId, latest, setCursors);
  }

  async function claim() {
    if (!socket || !selected) return;
    const parsed = conversationAckSchema.safeParse(
      await emitAck(socket, 'conversation.claim', { conversationId: selected.id }),
    );
    if (!parsed.success || !parsed.data.ok) {
      toast.notify('error', ackMessage(parsed, 'Não foi possível assumir'));
      return;
    }
    const conversation = parsed.data.conversation;
    setConversations((current) => upsertConversation(current, conversation));
    toast.notify('ok', 'Atendimento assumido');
  }

  async function send() {
    if (!socket || !selected) return;
    const body = draft.trim();
    if (!body) return;
    const requestId = crypto.randomUUID();
    setDraft('');
    const parsed = messageSendAckSchema.safeParse(
      await emitAck(socket, 'message.send', { conversationId: selected.id, requestId, body }),
    );
    if (!parsed.success || !parsed.data.ok) {
      setDraft(body);
      toast.notify('error', ackMessage(parsed, 'Mensagem recusada'));
      return;
    }
  }

  async function release() {
    if (!socket || !selected) return;
    const parsed = conversationAckSchema.safeParse(
      await emitAck(socket, 'conversation.release', { conversationId: selected.id }),
    );
    if (!parsed.success || !parsed.data.ok) {
      toast.notify('error', ackMessage(parsed, 'Não foi possível devolver'));
      return;
    }
    const conversation = parsed.data.conversation;
    setConversations((current) => upsertConversation(current, conversation));
    toast.notify('ok', 'Contato devolvido à fila');
  }

  async function transfer() {
    if (!socket || !selected || !queueId) return;
    const parsed = conversationAckSchema.safeParse(
      await emitAck(socket, 'conversation.transfer', { conversationId: selected.id, queueId }),
    );
    if (!parsed.success || !parsed.data.ok) {
      toast.notify('error', ackMessage(parsed, 'Transferência recusada'));
      return;
    }
    const conversation = parsed.data.conversation;
    setConversations((current) => upsertConversation(current, conversation));
    toast.notify('ok', 'Atendimento transferido');
  }

  async function closeConversation() {
    if (!socket || !selected || !dispositionId) return;
    const parsed = conversationCloseAckSchema.safeParse(
      await emitAck(socket, 'conversation.close', { conversationId: selected.id, dispositionId }),
    );
    if (!parsed.success || !parsed.data.ok) {
      toast.notify('error', ackMessage(parsed, 'Não foi possível encerrar'));
      return;
    }
    const conversation = parsed.data.conversation;
    setConversations((current) => upsertConversation(current, conversation));
    setDispositionId('');
    toast.notify('ok', 'Atendimento encerrado. O visitante recebeu a pesquisa.');
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
        setConversations((currentConversations) => upsertConversation(currentConversations, data.conversation, profileRef.current.role !== 'agent'));
      },
    );
  }

  // Em tela estreita, se a conversa aberta sai da lista (encerrada ou devolvida), volta para a lista.
  useEffect(() => {
    if (layout === 'narrow' && screen === 'thread' && !selected) setScreen('queues');
  }, [layout, screen, selected]);

  const canTransfer = profile.role === 'supervisor' || profile.role === 'admin' || owns;
  const loading = link === 'disconnected' && conversations.length === 0;
  const narrow = layout === 'narrow';

  const detailProps = {
    conversation: selected,
    events: selectedId ? events[selectedId] ?? [] : [],
    queues: profile.queues,
    dispositions: profile.dispositions,
    queueId,
    dispositionId,
    now,
    owns,
    canTransfer,
    selfStatus,
    onQueue: setQueueId,
    onDisposition: setDispositionId,
    onRelease: () => setConfirming('release'),
    onTransfer: () => void transfer(),
    onClose: () => setConfirming('close'),
  };

  return (
    <div className="desk" data-layout={layout} ref={rootRef}>
      <div className="desk-grid">
        <QueueColumn
          queues={profile.queues}
          conversations={conversations}
          messages={messages}
          cursors={cursors}
          selectedId={selectedId}
          selfId={profile.selfId}
          supervisory={profile.role !== 'agent'}
          now={now}
          hidden={narrow && screen !== 'queues'}
          loading={loading}
          onSelect={selectConversation}
        />
        <ConversationPane
          conversation={selected}
          messages={selectedMessages}
          draft={draft}
          link={link}
          layout={layout}
          now={now}
          canReply={owns}
          canClaim={canClaim}
          readOnlyNote={readOnlyNote(profile.role, selected, selfStatus, atCapacity)}
          loading={loading}
          hidden={narrow && screen !== 'thread'}
          onDraft={setDraft}
          onSend={() => void send()}
          onClaim={() => void claim()}
          onOpenDetails={() => setDetailsOpen(true)}
          onBack={() => setScreen('queues')}
        />
        {layout === 'wide' ? <DetailColumn {...detailProps} variant="card" /> : null}
      </div>
      {layout !== 'wide' ? (
        <Drawer open={detailsOpen} onClose={() => setDetailsOpen(false)} title="Detalhes do atendimento">
          <DetailColumn {...detailProps} variant="plain" />
        </Drawer>
      ) : null}
      <ConfirmDialog
        open={confirming === 'release'}
        title="Devolver à fila?"
        description="O contato volta para a fila de espera e outro agente poderá assumir o atendimento."
        confirmLabel="Devolver à fila"
        onCancel={() => setConfirming(null)}
        onConfirm={() => {
          setConfirming(null);
          void release();
        }}
      />
      <ConfirmDialog
        open={confirming === 'close'}
        title="Encerrar o atendimento?"
        description="O visitante receberá a pesquisa de satisfação e a conversa será classificada. Essa ação não pode ser desfeita."
        confirmLabel="Encerrar atendimento"
        danger
        onCancel={() => setConfirming(null)}
        onConfirm={() => {
          setConfirming(null);
          void closeConversation();
        }}
      />
    </div>
  );
}

function readOnlyNote(
  role: AuthMe['role'],
  conversation: ConversationSummary | null,
  selfStatus: PresenceStatus | null,
  atCapacity: boolean,
): string | null {
  if (!conversation) return null;
  if (role !== 'agent') return 'Modo supervisão: você acompanha a conversa sem responder.';
  switch (conversation.status) {
    case 'queued':
      if (selfStatus !== 'available') return 'Fique disponível para assumir este atendimento.';
      return atCapacity ? 'Você atingiu o limite de atendimentos simultâneos.' : null;
    case 'assigned':
      return 'Este atendimento é de outro agente.';
    case 'awaiting_survey':
      return 'Aguardando a resposta do visitante à pesquisa.';
    case 'closed':
      return 'Esta conversa foi encerrada.';
    default: {
      const unexpected: never = conversation.status;
      return unexpected;
    }
  }
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
