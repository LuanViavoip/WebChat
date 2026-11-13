import { useEffect, useRef } from 'react';
import type { TypingState } from '../chat/ChatSession';
import { formatDateSeparator, isSameCalendarDay } from '../chat/dates';
import type { UploadView } from '../chat/uploads';
import type { ChatMessage } from '../domain/message';
import type { OpenImage } from './attachments/MediaBody';
import { MessageBubble } from './MessageBubble';

export function MessageList({
  messages,
  typing,
  onRetry,
  hidden = false,
  empty = false,
  uploads,
  onCancelUpload,
  onOpenImage,
}: {
  messages: ChatMessage[];
  typing: TypingState;
  onRetry?: (messageId: string) => void;
  hidden?: boolean;
  empty?: boolean;
  uploads?: Readonly<Record<string, UploadView>>;
  onCancelUpload?: (id: string) => void;
  onOpenImage?: (image: OpenImage, opener: HTMLElement) => void;
}) {
  const scrollerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const node = scrollerRef.current;
    if (!node) {
      return;
    }
    node.scrollTop = node.scrollHeight;
  }, [messages, typing.isTyping]);

  return (
    <div className="message-list" ref={scrollerRef} hidden={hidden}>
      <div role="log" aria-label="Mensagens">
        {empty ? <p className="conversation-empty">Nenhuma mensagem ainda</p> : null}
        {messages.map((message, index) => {
          const previous = messages[index - 1];
          const showDate = !previous || !isSameCalendarDay(previous.timestamp, message.timestamp);
          const showTail = isFirstInGroup(previous, message, showDate);
          const upload = uploads?.[message.id] ?? (message.clientId ? uploads?.[message.clientId] : undefined);
          return (
            <div key={message.id} className={`message-row ${message.direction === 'client' ? 'out' : 'in'}`}>
              {showDate ? (
                <div className="date-separator">
                  <span>{formatDateSeparator(message.timestamp)}</span>
                </div>
              ) : null}
              <MessageBubble
                message={message}
                showTail={showTail}
                {...(onRetry ? { onRetry } : {})}
                {...(upload ? { upload } : {})}
                {...(onCancelUpload ? { onCancelUpload } : {})}
                {...(onOpenImage ? { onOpenImage } : {})}
              />
            </div>
          );
        })}
        {typing.isTyping ? (
          <p className="typing-indicator">{typing.actorName} está digitando…</p>
        ) : null}
      </div>
    </div>
  );
}

function isFirstInGroup(previous: ChatMessage | undefined, current: ChatMessage, newDay: boolean): boolean {
  if (!previous || newDay) {
    return true;
  }
  return previous.direction !== current.direction || previous.author.id !== current.author.id;
}
