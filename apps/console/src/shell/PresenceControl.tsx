import type { DesiredPresence, PresenceStatus, Role } from '@viavoip/protocol';
import { presenceLabel } from '../desk/format.js';
import { presenceTone } from '../desk/presence.js';
import type { LinkState } from '../realtime.js';
import { Select } from '../ui/Field.js';
import { StatusBadge } from '../ui/StatusBadge.js';

export function PresenceControl({
  role,
  status,
  link,
  onChange,
}: {
  role: Role;
  status: PresenceStatus | null;
  link: LinkState;
  onChange: (status: DesiredPresence) => void;
}) {
  if (role !== 'agent') {
    if (!status || status === 'offline') return null;
    return <StatusBadge tone={presenceTone(status)} dot>{presenceLabel(status)}</StatusBadge>;
  }
  const settable = status === 'available' || status === 'busy' || status === 'away';
  return (
    <label className="presence-control">
      <span className="sr-only">Presença</span>
      <Select
        data-testid="presence"
        value={status ?? 'unknown'}
        disabled={!settable || link !== 'connected'}
        onChange={(event) => {
          const next = event.target.value;
          if (next === 'available' || next === 'busy' || next === 'away') onChange(next);
        }}
      >
        <option value="unknown" disabled>Presença: —</option>
        <option value="offline" disabled>Offline</option>
        <option value="available">Disponível</option>
        <option value="busy">Ocupado</option>
        <option value="away">Ausente</option>
      </Select>
    </label>
  );
}
