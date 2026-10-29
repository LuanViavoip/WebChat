import {
  internalHistoryAckSchema,
  internalListAckSchema,
  internalMessageSchema,
  internalOpenAckSchema,
  messageSendAckSchema,
  sectorListAckSchema,
  type InternalConversation,
  type InternalMessage,
} from '@viavoip/protocol';
import { ArrowLeft, MessagesSquare, UserPlus, Users } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Socket } from 'socket.io-client';
import { groupMessagesByDay, mergeMessages } from '../desk/state.js';
import { ackMessage, emitAck, type LinkState } from '../realtime.js';
import { Avatar } from '../ui/Avatar.js';
import { Button } from '../ui/Button.js';
import { Composer } from '../ui/Composer.js';
import { Field, Select } from '../ui/Field.js';
import { useNow } from '../ui/hooks.js';
import { MessageBubble } from '../ui/MessageBubble.js';
import { EmptyState } from '../ui/states.js';
import { StatusBadge } from '../ui/StatusBadge.js';
import { useToast } from '../ui/Toast.js';
import { recoverAndCommitInternalHistory } from './history-sync.js';

export function InternalChat({
  socket,
  selfId,
  link,
}: {
  socket: Socket | null;
  selfId: string;
  link: LinkState;
}) {
  const [conversations, setConversations] = useState<InternalConversation[]>([]);
  const [peers, setPeers] = useState<{ agentId: string; name: string }[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Record<string, InternalMessage[]>>({});
  const messagesRef = useRef(messages);
  messagesRef.current = messages;
  const historyCursors = useRef<Record<string, string>>({});
  const [draft, setDraft] = useState('');
  const [peerId, setPeerId] = useState('');
  const [screen, setScreen] = useState<'list' | 'thread'>('list');
  const toast = useToast();
  const now = useNow(30_000);
  const [connectionVersion, setConnectionVersion] = useState(0);
  const [hasOlderById, setHasOlderById] = useState<Record<string, boolean>>({});
  const [loadingOlder, setLoadingOlder] = useState(false);

  useEffect(() => {
    if (!socket) return;
    const reload = () => {
      void emitAck(socket, 'internal.list', {}).then((ack) => {
        const parsed = internalListAckSchema.safeParse(ack);
        if (!parsed.success || !parsed.data.ok) return;
        setConversations(parsed.data.conversations);
      });
      void emitAck(socket, 'sector.list', {}).then((ack) => {
        const parsed = sectorListAckSchema.safeParse(ack);
        if (!parsed.success || !parsed.data.ok) return;
        const people = new Map<string, string>();
        for (const sector of parsed.data.sectors) {
          for (const person of [...sector.members, ...sector.supervisors]) {
            if (person.agentId !== selfId) people.set(person.agentId, person.name);
          }
        }
        setPeers([...people.entries()].map(([agentId, name]) => ({ agentId, name })));
      });
    };
    const onConnect = () => {
      setConnectionVersion((version) => version + 1);
      reload();
    };
    const onMessage = (payload: unknown) => {
      const parsed = internalMessageSchema.safeParse(payload);
      if (!parsed.success) return;
      setMessages((current) => {
        const existing = current[parsed.data.conversationId] ?? [];
        const merged = mergeMessages(existing, [parsed.data]);
        if (merged.length === existing.length) return current;
        return { ...current, [parsed.data.conversationId]: merged };
      });
      reload();
    };
    socket.on('internal.message.new', onMessage);
    socket.on('internal.conversation.updated', reload);
    socket.on('connect', onConnect);
    if (socket.connected) onConnect();
    return () => {
      socket.off('internal.message.new', onMessage);
      socket.off('internal.conversation.updated', reload);
      socket.off('connect', onConnect);
    };
  }, [selfId, socket]);

  useEffect(() => {
    if (!socket || !selectedId) return;
    void (async () => {
      const existing = messagesRef.current[selectedId] ?? [];
      const initialCursor = historyCursors.current[selectedId];
      try {
        const recovered = await recoverAndCommitInternalHistory(initialCursor, async (cursor) => {
          const ack = await emitAck(socket, 'internal.history', {
            conversationId: selectedId,
            ...(cursor ? { afterMessageId: cursor, limit: 100 } : {}),
          }).catch(() => null);
          const parsed = internalHistoryAckSchema.safeParse(ack);
          if (!parsed.success || !parsed.data.ok) {
            throw new Error(ackMessage(parsed, 'Histórico indisponível'));
          }
          return parsed.data.messages;
        }, (recovery) => {
          if (recovery.cursor) historyCursors.current[selectedId] = recovery.cursor;
          if (!initialCursor) {
            setHasOlderById((current) => ({ ...current, [selectedId]: recovery.hasOlder }));
          }
          setMessages((current) => ({
            ...current,
            [selectedId]: mergeMessages(current[selectedId] ?? [], recovery.messages),
          }));
        });
        const latest = recovered.messages.at(-1) ?? existing.at(-1);
        if (latest) {
          void emitAck(socket, 'internal.message.read', { conversationId: selectedId, messageId: latest.id });
        }
      } catch (error) {
        toast.notify('error', error instanceof Error ? error.message : 'Histórico indisponível');
      }
    })();
  }, [connectionVersion, selectedId, socket]);

  async function loadOlder() {
    if (!socket || !selectedId || loadingOlder) return;
    const oldest = messages[selectedId]?.[0];
    if (!oldest) return;
    setLoadingOlder(true);
    try {
      const ack = await emitAck(socket, 'internal.history', {
        conversationId: selectedId,
        beforeMessageId: oldest.id,
        limit: 50,
      });
      const parsed = internalHistoryAckSchema.safeParse(ack);
      if (!parsed.success || !parsed.data.ok) {
        toast.notify('error', ackMessage(parsed, 'Histórico indisponível'));
        return;
      }
      const olderMessages = parsed.data.messages;
      setHasOlderById((current) => ({ ...current, [selectedId]: olderMessages.length === 50 }));
      setMessages((current) => ({
        ...current,
        [selectedId]: mergeMessages(current[selectedId] ?? [], olderMessages),
      }));
    } finally {
      setLoadingOlder(false);
    }
  }

  async function openDirect() {
    if (!socket || !peerId) return;
    const parsed = internalOpenAckSchema.safeParse(await emitAck(socket, 'internal.open', { peerId }));
    if (!parsed.success || !parsed.data.ok) {
      toast.notify('error', ackMessage(parsed, 'Conversa recusada'));
      return;
    }
    setSelectedId(parsed.data.conversation.id);
    setScreen('thread');
    setPeerId('');
    const listed = internalListAckSchema.safeParse(await emitAck(socket, 'internal.list', {}));
    if (listed.success && listed.data.ok) setConversations(listed.data.conversations);
  }

  async function send() {
    if (!socket || !selectedId) return;
    const body = draft.trim();
    if (!body) return;
    const requestId = crypto.randomUUID();
    setDraft('');
    const parsed = messageSendAckSchema.safeParse(
      await emitAck(socket, 'internal.message.send', { conversationId: selectedId, requestId, body }),
    );
    if (!parsed.success || !parsed.data.ok) {
      setDraft(body);
      toast.notify('error', ackMessage(parsed, 'Mensagem recusada'));
    }
  }

  const selectedMessages = selectedId ? messages[selectedId] ?? [] : [];
  const selected = conversations.find((conversation) => conversation.id === selectedId) ?? null;
  const groups = useMemo(() => groupMessagesByDay(selectedMessages, now), [selectedMessages, now]);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const list = listRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [selectedMessages.length, selectedId]);

  return (
    <div className="chat" data-screen={screen}>
      <section className="desk-card chat__list" aria-label="Conversas internas">
        <header className="desk-card__head">
          <h2>Chat interno</h2>
          <StatusBadge tone={link === 'connected' ? 'success' : 'warning'} dot>{link === 'connected' ? 'Conectado' : 'Reconectando'}</StatusBadge>
        </header>
        <div className="chat__new">
          <Field label="Nova conversa direta">
            <Select data-testid="internal-peer" value={peerId} onChange={(event) => setPeerId(event.target.value)}>
              <option value="">Escolha uma pessoa</option>
              {peers.map((peer) => (
                <option key={peer.agentId} value={peer.agentId}>{peer.name}</option>
              ))}
            </Select>
          </Field>
          <Button variant="secondary" icon={<UserPlus size={16} />} onClick={() => void openDirect()} disabled={!peerId}>Iniciar</Button>
        </div>
        <div className="chat__items" role="list">
          {conversations.length === 0 ? <p className="desk-queues__empty">Nenhuma conversa ainda.</p> : null}
          {conversations.map((conversation) => (
            <button
              type="button"
              key={conversation.id}
              role="listitem"
              className={conversation.id === selectedId ? 'chat-item is-selected' : 'chat-item'}
              aria-current={conversation.id === selectedId ? 'true' : undefined}
              onClick={() => {
                setSelectedId(conversation.id);
                setScreen('thread');
              }}
            >
              {conversation.kind === 'group' ? (
                <span className="ui-avatar ui-avatar--group" style={{ width: 40, height: 40 }} aria-hidden="true"><Users size={18} /></span>
              ) : (
                <Avatar name={conversation.title} size={40} />
              )}
              <span className="chat-item__body">
                <strong>{conversation.title}</strong>
                <small>{conversation.kind === 'group' ? `Grupo · ${conversation.participants.length} pessoas` : 'Conversa direta'}</small>
              </span>
              {conversation.unread > 0 ? <em className="contact__unread" data-testid="internal-unread">{conversation.unread}</em> : null}
            </button>
          ))}
        </div>
      </section>
      <section className="desk-card desk-thread chat__thread" aria-label="Conversa interna">
        <header className="desk-thread__head">
          <button type="button" className="ui-icon-button chat__back" aria-label="Voltar para as conversas" onClick={() => setScreen('list')}>
            <ArrowLeft size={20} aria-hidden="true" />
          </button>
          {selected ? <Avatar name={selected.title} size={40} group={selected.kind === 'group'} /> : null}
          <div className="desk-thread__title">
            <h2>{selected ? selected.title : 'Nenhuma conversa'}</h2>
            {selected ? <p>{selected.kind === 'group' ? `Grupo · ${selected.participants.length} pessoas` : 'Conversa direta'}</p> : null}
          </div>
        </header>
        {!selected ? (
          <EmptyState icon={MessagesSquare} title="Escolha uma conversa" description="Selecione uma conversa da lista ou inicie uma conversa direta com alguém da equipe." />
        ) : (
          <>
            <div className="desk-messages" ref={listRef} data-testid="internal-thread" aria-live="polite">
              {selectedId && hasOlderById[selectedId] ? (
                <Button variant="secondary" size="sm" onClick={() => void loadOlder()} disabled={loadingOlder}>
                  {loadingOlder ? 'Carregando…' : 'Carregar mensagens anteriores'}
                </Button>
              ) : null}
              {selectedMessages.length === 0 ? <p className="desk-messages__empty">Sem mensagens ainda.</p> : null}
              {groups.map((group) => (
                <div className="desk-day" key={group.key}>
                  <p className="desk-day__label"><span>{group.label}</span></p>
                  {group.messages.map((message) => (
                    <MessageBubble
                      key={message.id}
                      variant={message.senderId === selfId ? 'agent' : 'visitor'}
                      author={message.senderId === selfId ? undefined : message.senderName}
                      body={message.body}
                      createdAt={message.createdAt}
                    />
                  ))}
                </div>
              ))}
            </div>
            <div className="desk-footer">
              <Composer
                value={draft}
                onChange={setDraft}
                onSend={() => void send()}
                testId="internal-draft"
                placeholder="Escreva uma mensagem"
                disabled={link !== 'connected'}
                resetKey={selected.id}
              />
            </div>
          </>
        )}
      </section>
    </div>
  );
}
