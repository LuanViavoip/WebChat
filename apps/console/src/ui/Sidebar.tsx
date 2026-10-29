import { ChevronsLeft, ChevronsRight, type LucideIcon } from 'lucide-react';
import { useEffect, useRef } from 'react';
import iconUrl from './assets/icon-viavoip.png';
import logoUrl from './assets/logo-viavoip.png';

export type NavItem = { id: string; label: string; icon: LucideIcon; badge?: number };
export type NavGroup = { id: string; label: string; items: NavItem[] };

type Props = {
  groups: NavGroup[];
  activeId: string;
  onSelect: (id: string) => void;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  /** Gaveta aberta em telas estreitas. */
  open: boolean;
  onClose: () => void;
};

/**
 * Menu lateral navy. A navegação fica em `nav[aria-label="Central"]`, só com os botões das seções;
 * o controle de recolher fica fora dela.
 */
export function Sidebar({ groups, activeId, onSelect, collapsed, onToggleCollapsed, open, onClose }: Props) {
  const navRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!open) return;
    const active = navRef.current?.querySelector<HTMLElement>('[aria-current="page"]');
    active?.focus();
  }, [open]);

  return (
    <>
      <div className="sidebar-overlay" data-open={open} onClick={onClose} aria-hidden="true" />
      <aside
        className="sidebar"
        id="app-sidebar"
        data-collapsed={collapsed}
        data-open={open}
        onKeyDown={(event) => {
          if (event.key === 'Escape' && open) onClose();
        }}
      >
        <div className="sidebar__brand">
          <img className="sidebar__logo" src={logoUrl} alt="ViaVoip" />
          <img className="sidebar__mark" src={iconUrl} alt="" aria-hidden="true" />
        </div>
        <nav className="sidebar__nav" aria-label="Central" ref={navRef}>
          {groups.map((group) => (
            <div className="sidebar__group" key={group.id}>
              <p className="sidebar__group-label">{group.label}</p>
              <ul>
                {group.items.map((item) => {
                  const Icon = item.icon;
                  const active = item.id === activeId;
                  return (
                    <li key={item.id}>
                      <button
                        type="button"
                        className="sidebar__item"
                        aria-current={active ? 'page' : undefined}
                        title={item.label}
                        onClick={() => {
                          onSelect(item.id);
                          onClose();
                        }}
                      >
                        <Icon size={20} aria-hidden="true" />
                        <span className="sidebar__label">{item.label}</span>
                        {item.badge && item.badge > 0 ? <em className="sidebar__badge">{item.badge}</em> : null}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>
        <div className="sidebar__foot">
          <button
            type="button"
            className="sidebar__collapse"
            onClick={onToggleCollapsed}
            aria-label={collapsed ? 'Expandir menu lateral' : 'Recolher menu lateral'}
            aria-expanded={!collapsed}
            aria-controls="app-sidebar"
          >
            {collapsed ? <ChevronsRight size={18} aria-hidden="true" /> : <ChevronsLeft size={18} aria-hidden="true" />}
            <span className="sidebar__label">Recolher</span>
          </button>
        </div>
      </aside>
    </>
  );
}
