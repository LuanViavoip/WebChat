import { useRef, useState, type KeyboardEvent } from 'react';
import { insertAtCursor } from '../chat/textCursor';
import { EmojiPicker } from './EmojiPicker';

export function Composer({
  onSend,
  disabled,
}: {
  onSend: (text: string) => void;
  disabled: boolean;
}) {
  const [text, setText] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);
  const fieldRef = useRef<HTMLTextAreaElement>(null);

  function submit() {
    const next = text.trim();
    if (!next || disabled) {
      return;
    }
    onSend(next);
    setText('');
    setPickerOpen(false);
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.nativeEvent.isComposing) {
      return;
    }
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      submit();
    }
  }

  function insertEmoji(emoji: string) {
    const field = fieldRef.current;
    const start = field?.selectionStart ?? text.length;
    const end = field?.selectionEnd ?? text.length;
    const next = insertAtCursor(text, emoji, start, end);
    setText(next.text);
    setPickerOpen(false);
    requestAnimationFrame(() => {
      field?.focus();
      field?.setSelectionRange(next.caret, next.caret);
    });
  }

  return (
    <div className="composer">
      {pickerOpen ? <EmojiPicker onPick={insertEmoji} /> : null}
      <div className="composer-row">
        <button
          type="button"
          className="icon-button"
          aria-label="Abrir seletor de emojis"
          aria-expanded={pickerOpen}
          disabled={disabled}
          onClick={() => {
            setPickerOpen((open) => !open);
          }}
        >
          ☺
        </button>
        <label className="composer-field">
          <span className="sr-only">Mensagem</span>
          <textarea
            ref={fieldRef}
            value={text}
            disabled={disabled}
            rows={1}
            placeholder="Mensagem"
            aria-label="Mensagem"
            onChange={(event) => {
              setText(event.target.value);
            }}
            onKeyDown={onKeyDown}
          />
        </label>
        <button type="button" className="send-button" aria-label="Enviar" disabled={disabled} onClick={submit}>
          Enviar
        </button>
      </div>
    </div>
  );
}
