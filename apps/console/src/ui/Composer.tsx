import { Send } from 'lucide-react';
import { useId, useLayoutEffect, useRef, type FormEvent, type KeyboardEvent } from 'react';
import { Button } from './Button.js';
import { Textarea } from './Field.js';

const maxHeight = 160;

/**
 * Campo de mensagem: textarea com altura automática. Enter envia; Shift+Enter quebra a linha
 * (e Enter durante composição de IME não envia).
 */
export function Composer({
  value,
  onChange,
  onSend,
  testId,
  placeholder = 'Responder',
  disabled = false,
  resetKey,
}: {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  testId: string;
  placeholder?: string;
  disabled?: boolean;
  /** Muda quando a conversa muda, para recalcular a altura. */
  resetKey?: string;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const hintId = useId();

  useLayoutEffect(() => {
    const field = ref.current;
    if (!field) return;
    field.style.height = 'auto';
    field.style.height = `${Math.min(field.scrollHeight, maxHeight)}px`;
  }, [value, resetKey]);

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    if (value.trim() && !disabled) onSend();
  }

  return (
    <form
      className="composer"
      onSubmit={(event: FormEvent) => {
        event.preventDefault();
        if (value.trim() && !disabled) onSend();
      }}
    >
      <Textarea
        ref={ref}
        data-testid={testId}
        aria-label="Mensagem"
        aria-describedby={hintId}
        rows={1}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
      />
      <Button type="submit" icon={<Send size={16} />} disabled={disabled || !value.trim()}>Enviar</Button>
      <p id={hintId} className="composer__hint">Enter envia · Shift+Enter quebra a linha</p>
    </form>
  );
}
