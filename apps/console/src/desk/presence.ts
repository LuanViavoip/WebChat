import type { PresenceStatus } from '@viavoip/protocol';
import type { Tone } from '../ui/Card.js';

/** `null` = presença desconhecida (sem conexão, ou ainda não informada pelo servidor). */
export function presenceTone(status: PresenceStatus | null): Tone {
  switch (status) {
    case 'available':
      return 'success';
    case 'busy':
      return 'warning';
    case 'away':
      return 'info';
    case 'offline':
    case null:
      return 'neutral';
    default: {
      const unexpected: never = status;
      return unexpected;
    }
  }
}
