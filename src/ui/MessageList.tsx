import { useEffect, useRef } from 'react';
import { formatDateSeparator, isSameCalendarDay } from '../chat/dates';
import type { ChatMessage } from '../domain/message';
import type { TypingState } from '../chat/ChatSession';
import { MessageBubble } from './MessageBubble';

export function MessageList({
  messages,
  typing,
}: {
  messages: ChatMessage[];
  typing: TypingState;
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
    <div className="message-list" ref={scrollerRef} role="log" aria-live="polite" aria-label="Mensagens">
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
            <MessageBubble message={message} />
          </div>
        );
      })}
      {typing.isTyping ? (
        <p className="typing-indicator" aria-live="polite">
          {typing.actorName} está digitando…
        </p>
      ) : null}
    </div>
  );
}
