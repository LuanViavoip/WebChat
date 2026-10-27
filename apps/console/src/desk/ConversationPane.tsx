import type { ConversationSummary, MessageRecord } from '@viavoip/protocol';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { formatClock, statusLabel, visitorLabel } from './format.js';

type LinkState = 'connected' | 'reconnecting' | 'disconnected';

type Props = {
  conversation: ConversationSummary | null;
  messages: MessageRecord[];
  draft: string;
  link: LinkState;
  canReply: boolean;
  canClaim: boolean;
  loading: boolean;
  onDraft: (value: string) => void;
  onSend: () => void;
  onClaim: () => void;
  onOpenDetails: () => void;
  active: boolean;
};

export function ConversationPane({
  conversation,
  messages,
  draft,
  link,
  canReply,
  canClaim,
  loading,
  onDraft,
  onSend,
  onClaim,
  onOpenDetails,
  active,
}: Props) {
  const listRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);
  const [pendingBelow, setPendingBelow] = useState(false);

  useEffect(() => {
    stickRef.current = true;
    setPendingBelow(false);
  }, [conversation?.id]);

  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    if (stickRef.current) {
      list.scrollTop = list.scrollHeight;
      setPendingBelow(false);
      return;
    }
    setPendingBelow(true);
  }, [messages]);

  function onScroll() {
    const list = listRef.current;
    if (!list) return;
    const nearBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 48;
    stickRef.current = nearBottom;
    if (nearBottom) setPendingBelow(false);
  }

  function jumpToLatest() {
    const list = listRef.current;
    if (!list) return;
    stickRef.current = true;
    list.scrollTop = list.scrollHeight;
    setPendingBelow(false);
  }

  return (
    <section className={active ? 'pane thread-pane active' : 'pane thread-pane'} data-pane="thread" aria-label="Conversa">
      <header className="thread-head">
        <div>
          <p className="eyebrow">Conversa</p>
          <h2>{conversation ? visitorLabel(conversation.visitorDisplayName) : 'Nenhuma conversa'}</h2>
          {conversation ? (
            <p className="muted">
              {conversation.queueName} · {statusLabel(conversation.status)}
            </p>
          ) : null}
        </div>
        <div className="thread-tools">
          <p className="link" data-testid="connection">{linkLabel(link)}</p>
          <button className="ghost mobile-only" type="button" onClick={onOpenDetails}>Detalhes</button>
        </div>
      </header>
      {loading ? <p className="muted">Carregando sessão…</p> : null}
      {!loading && !conversation ? <p className="muted" data-testid="empty">Selecione um contato para atender.</p> : null}
      {conversation ? (
        <>
          <div className="messages" ref={listRef} onScroll={onScroll} aria-live="polite">
            {messages.length === 0 ? <p className="muted">Sem mensagens ainda.</p> : null}
            {messages.map((message) => (
              <article key={message.id} data-testid="message" className={message.senderType}>
                <p>{message.body}</p>
                <time dateTime={message.createdAt}>{formatClock(message.createdAt)}</time>
              </article>
            ))}
          </div>
          {pendingBelow ? (
            <button type="button" className="jump" onClick={jumpToLatest}>Novas mensagens</button>
          ) : null}
          {canClaim ? (
            <button data-testid="claim" type="button" onClick={onClaim}>Assumir</button>
          ) : null}
          {canReply ? (
            <form
              onSubmit={(event: FormEvent) => {
                event.preventDefault();
                onSend();
              }}
            >
              <label className="composer">
                Mensagem
                <input
                  data-testid="composer"
                  value={draft}
                  onChange={(event) => onDraft(event.target.value)}
                  placeholder="Responder"
                />
              </label>
              <button type="submit">Enviar</button>
            </form>
          ) : null}
        </>
      ) : null}
    </section>
  );
}

function linkLabel(link: LinkState): string {
  switch (link) {
    case 'connected':
      return 'Conectado';
    case 'reconnecting':
      return 'Reconectando';
    case 'disconnected':
      return 'Desconectado';
    default: {
      const neverLink: never = link;
      return neverLink;
    }
  }
}
