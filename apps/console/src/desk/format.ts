import type { ConversationStatus, PresenceStatus } from '@viavoip/protocol';

export function statusLabel(status: ConversationStatus): string {
  switch (status) {
    case 'queued':
      return 'Aguardando';
    case 'assigned':
      return 'Em atendimento';
    case 'awaiting_survey':
      return 'Pesquisa';
    case 'closed':
      return 'Encerrada';
    default: {
      const neverStatus: never = status;
      return neverStatus;
    }
  }
}

export function presenceLabel(status: PresenceStatus): string {
  switch (status) {
    case 'available':
      return 'Disponível';
    case 'busy':
      return 'Ocupado';
    case 'away':
      return 'Ausente';
    case 'offline':
      return 'Desconectado';
    default: {
      const neverStatus: never = status;
      return neverStatus;
    }
  }
}

export function formatClock(iso: string): string {
  return new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
}

export function formatDuration(fromIso: string, now: number): string {
  const seconds = Math.max(0, Math.floor((now - Date.parse(fromIso)) / 1000));
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  if (hours > 0) return `${hours}h ${String(minutes % 60)}min`;
  if (minutes > 0) return `${minutes} min`;
  return `${seconds} s`;
}

export function visitorLabel(name: string | null): string {
  return name ?? 'Visitante';
}
