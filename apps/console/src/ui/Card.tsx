import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

export function Card({
  title,
  actions,
  children,
  className,
}: {
  title?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={className ? `ui-card ${className}` : 'ui-card'}>
      {title || actions ? (
        <header className="ui-card__head">
          {title ? <h2>{title}</h2> : <span />}
          {actions ? <div className="ui-card__actions">{actions}</div> : null}
        </header>
      ) : null}
      {children}
    </section>
  );
}

export type Tone = 'success' | 'warning' | 'error' | 'info' | 'neutral';

/**
 * Indicador numérico. Mantém `article` + `strong` por compatibilidade com o roteiro de verificação.
 * A descrição vai só no `title` (tooltip): texto visível a mais confundiria a busca por rótulo.
 */
export function StatCard({
  label,
  value,
  icon: Icon,
  tone = 'neutral',
  description,
}: {
  label: string;
  value: number | string;
  icon?: LucideIcon;
  tone?: Tone;
  description?: string;
}) {
  return (
    <article className={`ui-stat ui-stat--${tone}`} title={description}>
      {Icon ? (
        <span className="ui-stat__icon" aria-hidden="true"><Icon size={18} /></span>
      ) : null}
      <div>
        <p className="ui-stat__label">{label}</p>
        <strong className="ui-stat__value">{value}</strong>
      </div>
    </article>
  );
}
