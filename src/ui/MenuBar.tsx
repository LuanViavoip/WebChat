import type { MenuOption } from '../domain/message';

export function MenuBar({
  options,
  onSelect,
  disabled,
}: {
  options: MenuOption[];
  onSelect: (option: MenuOption) => void;
  disabled: boolean;
}) {
  if (options.length === 0) {
    return null;
  }

  return (
    <div className="menu-bar" aria-label="Opções do atendimento">
      {options.map((option) => (
        <button
          key={option.key}
          type="button"
          className="menu-chip"
          disabled={disabled}
          onClick={() => {
            onSelect(option);
          }}
        >
          {option.key} — {option.label}
        </button>
      ))}
    </div>
  );
}
