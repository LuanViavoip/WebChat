import { QUICK_EMOJIS } from './emojis';

export function EmojiPicker({ onPick }: { onPick: (emoji: string) => void }) {
  return (
    <div className="emoji-picker" role="listbox" aria-label="Seletor de emojis">
      {QUICK_EMOJIS.map((emoji) => (
        <button
          key={emoji}
          type="button"
          className="emoji-button"
          role="option"
          aria-selected="false"
          aria-label={`Emoji ${emoji}`}
          onClick={() => {
            onPick(emoji);
          }}
        >
          {emoji}
        </button>
      ))}
    </div>
  );
}
