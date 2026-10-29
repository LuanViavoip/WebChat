import { AlertTriangle, Loader2 } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { Button } from './Button.js';

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  testId,
}: {
  icon?: LucideIcon;
  title: string;
  description?: string;
  action?: ReactNode;
  testId?: string;
}) {
  return (
    <div className="ui-state" data-testid={testId}>
      {Icon ? <span className="ui-state__icon" aria-hidden="true"><Icon size={24} /></span> : null}
      <h3>{title}</h3>
      {description ? <p>{description}</p> : null}
      {action}
    </div>
  );
}

export function LoadingState({ label = 'Carregando…' }: { label?: string }) {
  return (
    <div className="ui-state" role="status">
      <span className="ui-state__icon ui-spin" aria-hidden="true"><Loader2 size={24} /></span>
      <p>{label}</p>
    </div>
  );
}

export function ErrorState({ title = 'Algo deu errado', message, onRetry }: { title?: string; message?: string; onRetry?: () => void }) {
  return (
    <div className="ui-state ui-state--error" role="alert">
      <span className="ui-state__icon" aria-hidden="true"><AlertTriangle size={24} /></span>
      <h3>{title}</h3>
      {message ? <p>{message}</p> : null}
      {onRetry ? <Button variant="secondary" onClick={onRetry}>Tentar novamente</Button> : null}
    </div>
  );
}
