import { useEffect, useRef } from 'react';
import type { TypingState } from '../chat/ChatSession';
import { formatDateSeparator, isSameCalendarDay } from '../chat/dates';
import type { UploadView } from '../chat/uploads';
import type { ChatMessage, MenuOption } from '../domain/message';
import { isTextMessage } from '../domain/message';
import type { OpenImage } from './attachments/MediaBody';
import { MessageBubble } from './MessageBubble';

export function MessageList({
  messages,
  typing,
  onRetry,
  menu,
  menuDisabled,
  onMenuSelect,
  hidden = false,
  uploads,
  onCancelUpload,
  onOpenImage,
}: {
  messages: ChatMessage[];
  typing: TypingState;
  onRetry?: (messageId: string) => void;
  menu: MenuOption[];
  menuDisabled: boolean;
  onMenuSelect: (option: MenuOption) => void;
  hidden?: boolean;
  uploads?: Readonly<Record<string, UploadView>>;
  onCancelUpload?: (id: string) => void;
  onOpenImage?: (image: OpenImage, opener: HTMLElement) => void;
}) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const menuHostId = lastBotMenuHostId(messages, menu);

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
        {messages.map((message, index) => {
          const previous = messages[index - 1];
          const showDate = !previous || !isSameCalendarDay(previous.timestamp, message.timestamp);
          const showTail = isFirstInGroup(previous, message, showDate);
          const showMenu = menuHostId === message.id;
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
                menuDisabled={menuDisabled}
                onMenuSelect={onMenuSelect}
                {...(showMenu ? { menu } : {})}
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

function lastBotMenuHostId(messages: ChatMessage[], menu: MenuOption[]): string | undefined {
  if (menu.length === 0) {
    return undefined;
  }
  let lastBotTextId: string | undefined;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!message || !isTextMessage(message) || message.direction !== 'bot') {
      continue;
    }
    lastBotTextId ??= message.id;
    if (message.menu) {
      return message.id;
    }
  }
  return lastBotTextId;
}
