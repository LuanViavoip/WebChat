import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { EMOJI_COLUMNS, QUICK_EMOJIS } from './emojis';

export function EmojiPicker({ onPick }: { onPick: (emoji: string) => void }) {
  const labelId = useId();
  const listRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);

  useEffect(() => {
    listRef.current?.focus();
  }, []);

  function move(next: number) {
    const max = QUICK_EMOJIS.length - 1;
    setActive(Math.max(0, Math.min(max, next)));
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    switch (event.key) {
      case 'ArrowRight':
        event.preventDefault();
        move(active + 1);
        break;
      case 'ArrowLeft':
        event.preventDefault();
        move(active - 1);
        break;
      case 'ArrowDown':
        event.preventDefault();
        move(active + EMOJI_COLUMNS);
        break;
      case 'ArrowUp':
        event.preventDefault();
        move(active - EMOJI_COLUMNS);
        break;
      case 'Home':
        event.preventDefault();
        move(0);
        break;
      case 'End':
        event.preventDefault();
        move(QUICK_EMOJIS.length - 1);
        break;
      case 'Enter':
      case ' ':
        event.preventDefault();
        pick(active);
        break;
      default:
        break;
    }
  }

  function pick(index: number) {
    const emoji = QUICK_EMOJIS[index];
    if (emoji) {
      onPick(emoji);
    }
  }

  const activeId = `${labelId}-${String(active)}`;

  return (
    <div
      ref={listRef}
      className="emoji-picker"
      role="listbox"
      tabIndex={0}
      aria-labelledby={labelId}
      aria-activedescendant={activeId}
      onKeyDown={onKeyDown}
    >
      <span id={labelId} className="sr-only">
        Seletor de emojis
      </span>
      {QUICK_EMOJIS.map((emoji, index) => (
        <button
          key={`${emoji}-${String(index)}`}
          id={`${labelId}-${String(index)}`}
          type="button"
          className={`emoji-button${index === active ? ' emoji-button-active' : ''}`}
          role="option"
          tabIndex={-1}
          aria-selected={index === active}
          aria-label={`Emoji ${emoji}`}
          onClick={() => {
            pick(index);
          }}
        >
          {emoji}
        </button>
      ))}
    </div>
  );
}
