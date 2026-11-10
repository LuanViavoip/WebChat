import { useEffect, useRef } from 'react';
import { formatDateSeparator, isSameCalendarDay } from '../chat/dates';
import type { ChatMessage } from '../domain/message';
import type { TypingState } from '../chat/ChatSession';
import { MessageBubble } from './MessageBubble';

export function MessageList({
  messages,
  typing,
  onRetry,
}: {
  messages: ChatMessage[];
  typing: TypingState;
  onRetry?: (messageId: string) => void;
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
    <div className="message-list" ref={scrollerRef}>
      <div role="log" aria-label="Mensagens">
        {messages.map((message, index) => {
          const previous = messages[index - 1];
          const showDate = !previous || !isSameCalendarDay(previous.timestamp, message.timestamp);
          return (
            <div key={message.id} className="message-row">
              {showDate ? (
                <div className="date-separator">
                  <span>{formatDateSeparator(message.timestamp)}</span>
                </div>
              ) : null}
              <MessageBubble message={message} {...(onRetry ? { onRetry } : {})} />
            </div>
          );
        })}
      </div>
      {typing.isTyping ? (
        <p className="typing-indicator">
          {typing.actorName} está digitando…
        </p>
      ) : null}
    </div>
  );
}
