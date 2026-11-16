import { Check, CheckCheck, CircleAlert, Clock } from 'lucide-react';
import type { MessageStatus } from '@viavoip/internal-domain';

const LABELS: Record<MessageStatus, string> = {
  sending: 'Enviando',
  sent: 'Enviada',
  delivered: 'Entregue',
  read: 'Lida',
  error: 'Erro ao enviar',
};

export function StatusTicks({ status }: { status: MessageStatus }) {
  const label = LABELS[status];
  return (
    <span className={`ticks ticks-${status}`} role="img" aria-label={label} title={label}>
      {glyph(status)}
    </span>
  );
}

function glyph(status: MessageStatus) {
  switch (status) {
    case 'sending':
      return <Clock size={14} strokeWidth={2} aria-hidden="true" />;
    case 'sent':
      return <Check size={14} strokeWidth={2.2} aria-hidden="true" />;
    case 'delivered':
      return <CheckCheck size={14} strokeWidth={2.2} aria-hidden="true" />;
    case 'read':
      return <CheckCheck size={14} strokeWidth={2.2} aria-hidden="true" />;
    case 'error':
      return <CircleAlert size={14} strokeWidth={2.2} aria-hidden="true" />;
    default: {
      const exhaustive: never = status;
      return exhaustive;
    }
  }
}
