import { useRef, type KeyboardEvent } from 'react';

export type TabItem = { id: string; label: string; badge?: number };

export function Tabs({
  tabs,
  value,
  onChange,
  label,
  idPrefix = 'tab',
  side = false,
}: {
  tabs: TabItem[];
  value: string;
  onChange: (id: string) => void;
  label: string;
  idPrefix?: string;
  /** Lista vertical em telas largas (CSS); as setas de cima e de baixo também navegam. */
  side?: boolean;
}) {
  const refs = useRef(new Map<string, HTMLButtonElement>());

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (!['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const index = tabs.findIndex((tab) => tab.id === value);
    let next = index;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = (index + 1) % tabs.length;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = (index - 1 + tabs.length) % tabs.length;
    if (event.key === 'Home') next = 0;
    if (event.key === 'End') next = tabs.length - 1;
    const target = tabs[next];
    if (!target) return;
    onChange(target.id);
    refs.current.get(target.id)?.focus();
  }

  return (
    <div className={side ? 'ui-tabs ui-tabs--side' : 'ui-tabs'} role="tablist" aria-label={label} onKeyDown={onKeyDown}>
      {tabs.map((tab) => (
        <button
          key={tab.id}
          ref={(node) => {
            if (node) refs.current.set(tab.id, node);
            else refs.current.delete(tab.id);
          }}
          id={`${idPrefix}-${tab.id}`}
          type="button"
          role="tab"
          aria-selected={tab.id === value}
          aria-controls={`${idPrefix}-panel-${tab.id}`}
          tabIndex={tab.id === value ? 0 : -1}
          className="ui-tabs__tab"
          onClick={() => onChange(tab.id)}
        >
          {tab.label}
          {tab.badge ? <em>{tab.badge}</em> : null}
        </button>
      ))}
    </div>
  );
}
