import { Menu } from 'lucide-react';
import type { ReactNode } from 'react';

export function Topbar({ title, onOpenMenu, children }: { title: string; onOpenMenu: () => void; children?: ReactNode }) {
  return (
    <header className="topbar">
      <button type="button" className="ui-icon-button topbar__menu" aria-label="Abrir menu" aria-controls="app-sidebar" onClick={onOpenMenu}>
        <Menu size={20} aria-hidden="true" />
      </button>
      <h1 className="topbar__title">{title}</h1>
      <div className="topbar__tools">{children}</div>
    </header>
  );
}
