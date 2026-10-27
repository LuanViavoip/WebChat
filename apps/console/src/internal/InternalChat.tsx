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
import { useEffect, useState } from 'react';
import type { Socket } from 'socket.io-client';
import { formatClock } from '../desk/format.js';
import type { LinkState } from '../desk/Desk.js';
import { ackMessage, emitAck } from '../realtime.js';

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
  const [draft, setDraft] = useState('');
  const [peerId, setPeerId] = useState('');
  const [notice, setNotice] = useState('');

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
    const onMessage = (payload: unknown) => {
      const parsed = internalMessageSchema.safeParse(payload);
      if (!parsed.success) return;
      setMessages((current) => {
        const existing = current[parsed.data.conversationId] ?? [];
        if (existing.some((item) => item.id === parsed.data.id)) return current;
        return { ...current, [parsed.data.conversationId]: [...existing, parsed.data] };
      });
      reload();
    };
    socket.on('internal.message.new', onMessage);
    socket.on('internal.conversation.updated', reload);
    socket.on('connect', reload);
    if (socket.connected) reload();
    return () => {
      socket.off('internal.message.new', onMessage);
      socket.off('internal.conversation.updated', reload);
      socket.off('connect', reload);
    };
  }, [selfId, socket]);

  useEffect(() => {
    if (!socket || !selectedId) return;
    void emitAck(socket, 'internal.history', { conversationId: selectedId }).then((ack) => {
      const parsed = internalHistoryAckSchema.safeParse(ack);
      if (!parsed.success || !parsed.data.ok) {
        setNotice(ackMessage(parsed, 'Histórico indisponível'));
        return;
      }
      const loaded = parsed.data.messages;
      setMessages((current) => ({ ...current, [selectedId]: loaded }));
      const latest = loaded.at(-1);
      if (latest) {
        void emitAck(socket, 'internal.message.read', { conversationId: selectedId, messageId: latest.id });
      }
    });
  }, [selectedId, socket]);

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
