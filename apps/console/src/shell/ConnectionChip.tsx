import { Wifi, WifiOff } from 'lucide-react';
import { linkLabel } from '../desk/format.js';
import type { LinkState } from '../realtime.js';
import { StatusBadge } from '../ui/StatusBadge.js';

const tones = { connected: 'success', reconnecting: 'warning', disconnected: 'error' } as const;

/** Estado do socket. É conectividade, não presença: a presença do agente tem controle próprio. */
export function ConnectionChip({ link }: { link: LinkState }) {
  const Icon = link === 'connected' ? Wifi : WifiOff;
  return (
    <span className="connection-chip" data-testid="connection" title="Conexão com a central">
      <StatusBadge tone={tones[link]}>
        <Icon size={14} aria-hidden="true" />
        <span className="connection-chip__label">{linkLabel(link)}</span>
      </StatusBadge>
    </span>
  );
}
