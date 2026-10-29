import type { ConversationSummary, MessageRecord } from '@viavoip/protocol';
import { ArrowLeft, ArrowDown, Info, MessageSquareText } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { LinkState } from '../realtime.js';
import { Avatar } from '../ui/Avatar.js';
import { Button } from '../ui/Button.js';
import { Composer } from '../ui/Composer.js';
import { MessageBubble } from '../ui/MessageBubble.js';
import { EmptyState, LoadingState } from '../ui/states.js';
import { StatusBadge } from '../ui/StatusBadge.js';
import { linkLabel, statusLabel, visitorLabel } from './format.js';
import type { DeskLayout } from './layout.js';
import { statusTone } from './QueueColumn.js';
import { dayKey, groupMessagesByDay } from './state.js';

type Props = {
  conversation: ConversationSummary | null;
  messages: MessageRecord[];
  draft: string;
  link: LinkState;
  layout: DeskLayout;
  now: number;
  canReply: boolean;
  canClaim: boolean;
  /** Motivo exibido no lugar do composer quando o usuário não pode responder. */
  readOnlyNote: string | null;
  loading: boolean;
  hidden: boolean;
  onDraft: (value: string) => void;
  onSend: () => void;
  onClaim: () => void;
  onOpenDetails: () => void;
  onBack: () => void;
};

export function ConversationPane({
  conversation,
  messages,
  draft,
  link,
  layout,
  now,
  canReply,
  canClaim,
  readOnlyNote,
  loading,
  hidden,
  onDraft,
  onSend,
  onClaim,
  onOpenDetails,
  onBack,
}: Props) {
  const listRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);
  const [pendingBelow, setPendingBelow] = useState(false);
  const today = dayKey(now);
  // `today` entra nas dependências para renovar "Hoje"/"Ontem" na virada do dia.
  const groups = useMemo(() => groupMessagesByDay(messages, now), [messages, today]);

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

  const linkTone = link === 'connected' ? 'success' : link === 'reconnecting' ? 'warning' : 'error';

  return (
    <section className="desk-card desk-thread" data-pane="thread" aria-label="Conversa" hidden={hidden}>
      <header className="desk-thread__head">
        {layout === 'narrow' ? (
          <button type="button" className="ui-icon-button" aria-label="Voltar para a lista" onClick={onBack}>
            <ArrowLeft size={20} aria-hidden="true" />
          </button>
        ) : null}
        {conversation ? <Avatar name={visitorLabel(conversation.visitorDisplayName)} size={40} /> : null}
        <div className="desk-thread__title">
          <h2>{conversation ? visitorLabel(conversation.visitorDisplayName) : 'Nenhuma conversa'}</h2>
          {conversation ? (
            <p>
              {conversation.queueName}
              <StatusBadge tone={statusTone(conversation.status)}>{statusLabel(conversation.status)}</StatusBadge>
            </p>
          ) : null}
        </div>
        <StatusBadge tone={linkTone} dot>{linkLabel(link)}</StatusBadge>
        {layout !== 'wide' && conversation ? (
          <button type="button" className="ui-icon-button" aria-label="Ver detalhes" onClick={onOpenDetails}>
            <Info size={20} aria-hidden="true" />
          </button>
        ) : null}
      </header>
      {loading ? <LoadingState label="Carregando sessão…" /> : null}
      {!loading && !conversation ? (
        <EmptyState
          testId="empty"
          icon={MessageSquareText}
          title="Selecione um contato para atender."
          description="Escolha uma conversa na lista para ver as mensagens e os detalhes do atendimento."
        />
      ) : null}
      {conversation ? (
        <>
          <div className="desk-messages" ref={listRef} onScroll={onScroll} aria-live="polite">
            {messages.length === 0 ? <p className="desk-messages__empty">Sem mensagens ainda.</p> : null}
            {groups.map((group) => (
              <div className="desk-day" key={group.key}>
                <p className="desk-day__label"><span>{group.label}</span></p>
                {group.messages.map((message) => (
                  <MessageBubble
                    key={message.id}
                    testId="message"
                    variant={message.senderType}
                    body={message.body}
                    createdAt={message.createdAt}
                  />
                ))}
              </div>
            ))}
          </div>
          {pendingBelow ? (
            <button type="button" className="desk-jump" onClick={jumpToLatest}>
              <ArrowDown size={14} aria-hidden="true" />
              Novas mensagens
            </button>
          ) : null}
          <div className="desk-footer">
            {canClaim ? (
              <Button data-testid="claim" onClick={onClaim} size="lg">Assumir</Button>
            ) : null}
            {canReply ? (
              <Composer
                value={draft}
                onChange={onDraft}
                onSend={onSend}
                testId="composer"
                resetKey={conversation.id}
              />
            ) : null}
            {!canReply && !canClaim && readOnlyNote ? <p className="desk-readonly">{readOnlyNote}</p> : null}
          </div>
        </>
      ) : null}
    </section>
  );
}
