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
import { useEffect, useRef, useState } from 'react';
import type { Socket } from 'socket.io-client';
import { formatClock } from '../desk/format.js';
import type { LinkState } from '../desk/Desk.js';
import { ackMessage, emitAck } from '../realtime.js';
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
  const [notice, setNotice] = useState('');
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
        setNotice(error instanceof Error ? error.message : 'Histórico indisponível');
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
        setNotice(ackMessage(parsed, 'Histórico indisponível'));
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
      setNotice(ackMessage(parsed, 'Conversa recusada'));
      return;
    }
    setSelectedId(parsed.data.conversation.id);
    setNotice('');
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
      setNotice(ackMessage(parsed, 'Mensagem recusada'));
    }
  }

  const selectedMessages = selectedId ? messages[selectedId] ?? [] : [];

  return (
    <section className="panel split">
      <div className="pane">
        <h2>Chat interno</h2>
        <p className="link">{link === 'connected' ? 'Conectado' : 'Reconectando'}</p>
        <label>
          Nova conversa direta
          <select data-testid="internal-peer" value={peerId} onChange={(event) => setPeerId(event.target.value)}>
            <option value="">Escolha uma pessoa</option>
            {peers.map((peer) => (
              <option key={peer.agentId} value={peer.agentId}>{peer.name}</option>
            ))}
          </select>
        </label>
        <button type="button" onClick={() => void openDirect()} disabled={!peerId}>Iniciar</button>
        <div role="list">
          {conversations.map((conversation) => (
            <button
              type="button"
              key={conversation.id}
              className={conversation.id === selectedId ? 'selected' : undefined}
              onClick={() => setSelectedId(conversation.id)}
            >
              <span>{conversation.kind === 'group' ? 'Grupo' : 'Direta'} · {conversation.title}</span>
              {conversation.unread > 0 ? <em>{conversation.unread}</em> : null}
            </button>
          ))}
        </div>
      </div>
      <div className="pane thread-pane">
        {selectedId && hasOlderById[selectedId] ? (
          <button type="button" onClick={() => void loadOlder()} disabled={loadingOlder}>
            {loadingOlder ? 'Carregando…' : 'Carregar mensagens anteriores'}
          </button>
        ) : null}
        <div className="messages" data-testid="internal-thread">
          {selectedMessages.map((message) => (
            <article key={message.id} className={message.senderId === selfId ? 'agent' : undefined}>
              <p>{message.senderName}</p>
              <p>{message.body}</p>
              <time dateTime={message.createdAt}>{formatClock(message.createdAt)}</time>
            </article>
          ))}
        </div>
        {notice ? <p className="error">{notice}</p> : null}
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void send();
          }}
        >
          <input className="composer" data-testid="internal-draft" value={draft} onChange={(event) => setDraft(event.target.value)} />
          <button type="submit" disabled={!selectedId || link !== 'connected'}>Enviar</button>
        </form>
      </div>
    </section>
  );
}

function mergeMessages(existing: InternalMessage[], incoming: InternalMessage[]): InternalMessage[] {
  const merged = new Map(existing.map((message) => [message.id, message]));
  for (const message of incoming) merged.set(message.id, message);
  return [...merged.values()].sort((left, right) =>
    left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id),
  );
}
