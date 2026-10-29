import { LogOut } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Avatar } from '../ui/Avatar.js';

export function AccountMenu({ name, roleLabel, onLogout }: { name: string; roleLabel: string; onLogout: () => void }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="account" ref={rootRef}>
      <button
        type="button"
        className="account__trigger"
        aria-label={`Conta de ${name}`}
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <Avatar name={name} size={32} />
        <span className="account__who">
          {name}
          <small>{roleLabel}</small>
        </span>
      </button>
      {open ? (
        <div className="account__menu">
          <header>
            <strong>{name}</strong>
            <span>{roleLabel}</span>
          </header>
          <button type="button" onClick={onLogout}>
            <LogOut size={16} aria-hidden="true" />
            Sair
          </button>
        </div>
      ) : null}
    </div>
  );
}
