import type { ReactNode } from 'react';

export function AppShell({
  sidebar,
  topbar,
  collapsed,
  children,
}: {
  sidebar: ReactNode;
  topbar: ReactNode;
  collapsed: boolean;
  children: ReactNode;
}) {
  return (
    <div className="app-shell" data-collapsed={collapsed}>
      <a
        className="skip-link"
        href="#conteudo"
        onClick={(event) => {
          event.preventDefault();
          document.getElementById('conteudo')?.focus();
        }}
      >
        Ir para o conteúdo
      </a>
      {sidebar}
      <div className="app-main">
        {topbar}
        <main className="app-content" id="conteudo" tabIndex={-1}>{children}</main>
      </div>
    </div>
  );
}
