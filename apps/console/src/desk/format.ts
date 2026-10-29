import type { ConversationStatus, PresenceStatus } from '@viavoip/protocol';
import type { LinkState } from '../realtime.js';

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
      return 'Offline';
    default: {
      const neverStatus: never = status;
      return neverStatus;
    }
  }
}

export function linkLabel(link: LinkState): string {
  switch (link) {
    case 'connected':
      return 'Conectado';
    case 'reconnecting':
      return 'Reconectando';
    case 'disconnected':
      return 'Desconectado';
    default: {
      const neverLink: never = link;
      return neverLink;
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

/** Duração em segundos, para métricas já agregadas. `null` vira travessão. */
export function formatSeconds(seconds: number | null): string {
  if (seconds === null) return '—';
  const rounded = Math.round(seconds);
  const minutes = Math.floor(rounded / 60);
  const hours = Math.floor(minutes / 60);
  if (hours > 0) return `${hours}h ${String(minutes % 60)}min`;
  if (minutes > 0) return `${minutes} min ${String(rounded % 60)} s`;
  return `${rounded} s`;
}

export function formatTime(iso: string): string {
  return new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(new Date(iso));
}

export function formatDateTime(iso: string): string {
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(iso));
}
