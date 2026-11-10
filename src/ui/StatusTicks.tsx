import type { MessageStatus } from '../domain/message';

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
    <span className={`ticks ticks-${status}`} aria-label={label} title={label}>
      {glyph(status)}
    </span>
  );
}

function glyph(status: MessageStatus): string {
  switch (status) {
    case 'sending':
      return '◌';
    case 'sent':
      return '✓';
    case 'delivered':
      return '✓✓';
    case 'read':
      return '✓✓';
    case 'error':
      return '!';
    default: {
      const exhaustive: never = status;
      return exhaustive;
    }
  }
}
