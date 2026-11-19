import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { MAX_FORWARD_TARGETS, type ConversationId } from '@viavoip/internal-domain';

export type ConversationPickerOption = {
  readonly id: ConversationId;
  readonly label: string;
  readonly subtitle?: string;
  readonly kind?: 'direct' | 'group';
  readonly disabledReason?: string;
};

export type ConversationPickerProps = {
  readonly options: readonly ConversationPickerOption[];
  readonly maxSelections?: number;
  readonly title?: string;
  readonly confirmLabel?: string;
  readonly searchPlaceholder?: string;
  readonly initialSelected?: readonly ConversationId[];
  readonly onConfirm: (selected: readonly ConversationId[]) => void;
  readonly onCancel: () => void;
};

export function ConversationPicker({
  options,
  maxSelections = MAX_FORWARD_TARGETS,
  title = 'Encaminhar para',
  confirmLabel = 'Encaminhar',
  searchPlaceholder = 'Pesquisar conversa',
  initialSelected = [],
  onConfirm,
  onCancel,
}: ConversationPickerProps) {
  const titleId = useId();
  const searchId = useId();
  const limitHintId = useId();
  const baseOptionId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<readonly ConversationId[]>(() => initialSelected.slice(0, maxSelections));

  useEffect(() => {
    searchRef.current?.focus();
  }, []);

  useEffect(() => {
    function onWindowKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key !== 'Escape') {
        return;
      }
      const dialog = dialogRef.current;
      if (dialog && (document.activeElement === document.body || dialog.contains(document.activeElement))) {
        event.preventDefault();
        onCancel();
      }
    }
    window.addEventListener('keydown', onWindowKeyDown);
    return () => {
      window.removeEventListener('keydown', onWindowKeyDown);
    };
  }, [onCancel]);

  const selectedSet = useMemo(() => new Set(selected), [selected]);
  const limitReached = selected.length >= maxSelections;

  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) {
      return options;
    }
    return options.filter((option) => {
      const labelMatch = option.label.toLowerCase().includes(term);
      const subtitleMatch = option.subtitle ? option.subtitle.toLowerCase().includes(term) : false;
      return labelMatch || subtitleMatch;
    });
  }, [options, query]);

  function toggle(option: ConversationPickerOption) {
    if (option.disabledReason) {
      return;
    }
    setSelected((current) => {
      if (current.includes(option.id)) {
        return current.filter((item) => item !== option.id);
      }
      if (current.length >= maxSelections) {
        return current;
      }
      return [...current, option.id];
    });
  }

  function handleOptionKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') {
      return;
    }
    const list = listRef.current;
    if (!list) {
      return;
    }
    const inputs = Array.from(list.querySelectorAll<HTMLInputElement>('input[type="checkbox"]:not(:disabled)'));
    const index = inputs.indexOf(event.currentTarget);
    if (index === -1 || inputs.length === 0) {
      return;
    }
    event.preventDefault();
    const delta = event.key === 'ArrowDown' ? 1 : -1;
    const nextIndex = (index + delta + inputs.length) % inputs.length;
    inputs[nextIndex]?.focus();
  }

  const maxLabel = String(maxSelections);
  const selectedCountLabel = String(selected.length);

  return (
    <div
      ref={dialogRef}
      className="conversation-picker"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
    >
      <div className="conversation-picker-header">
        <h2 id={titleId}>{title}</h2>
        <button type="button" onClick={onCancel} aria-label="Fechar">
          Fechar
        </button>
      </div>
      <div className="conversation-picker-search">
        <label htmlFor={searchId} className="sr-only">
          {searchPlaceholder}
        </label>
        <input
          ref={searchRef}
          id={searchId}
          type="search"
          value={query}
          placeholder={searchPlaceholder}
          aria-label={searchPlaceholder}
          onChange={(event) => {
            setQuery(event.target.value);
          }}
        />
      </div>
      <p id={limitHintId} className="conversation-picker-status" role="status" aria-live="polite">
        {limitReached
          ? `Limite de ${maxLabel} destinos atingido (${selectedCountLabel}/${maxLabel}).`
          : `Selecionados: ${selectedCountLabel} de ${maxLabel}`}
      </p>
      {filtered.length === 0 ? (
        <p className="conversation-picker-empty">Nenhuma conversa encontrada.</p>
      ) : (
        <ul ref={listRef} className="conversation-picker-list" aria-label="Destinos disponíveis">
          {filtered.map((option, index) => {
            const checked = selectedSet.has(option.id);
            const hasReason = Boolean(option.disabledReason);
            const blockedByLimit = !checked && limitReached;
            const disabled = hasReason || blockedByLimit;
            const indexLabel = String(index);
            const inputId = `${baseOptionId}-opt-${indexLabel}`;
            const reasonId = `${baseOptionId}-reason-${indexLabel}`;
            const describedBy = hasReason ? reasonId : blockedByLimit ? limitHintId : undefined;

            return (
              <li key={option.id} className="conversation-picker-item">
                <label htmlFor={inputId}>
                  <input
                    id={inputId}
                    type="checkbox"
                    checked={checked}
                    disabled={disabled}
                    aria-describedby={describedBy}
                    onKeyDown={handleOptionKeyDown}
                    onChange={() => {
                      toggle(option);
                    }}
                  />
                  <span>{option.label}</span>
                  {option.subtitle ? <span className="conversation-picker-subtitle">{option.subtitle}</span> : null}
                </label>
                {option.disabledReason ? (
                  <span id={reasonId} className="conversation-picker-disabled-reason">
                    {option.disabledReason}
                  </span>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
      <div className="conversation-picker-actions">
        <button type="button" onClick={onCancel}>
          Cancelar
        </button>
        <button
          type="button"
          disabled={selected.length === 0}
          onClick={() => {
            onConfirm(selected);
          }}
        >
          {`${confirmLabel} (${selectedCountLabel})`}
        </button>
      </div>
    </div>
  );
}
