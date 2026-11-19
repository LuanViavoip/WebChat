import type { MessageStatus } from '@viavoip/internal-domain';
import type { TransportStatus } from '../transport/ChatTransport';
import type { ComposeActivity } from '../transport/ChatTransport';

export type LiveActivity =
  | 'idle'
  | 'sending'
  | 'typing'
  | 'recording-audio'
  | 'connecting'
  | 'reconnecting'
  | 'error'
  | 'unseen';

export type LiveActivityInput = {
  error: string | null;
  connection: TransportStatus;
  typing: { activity: ComposeActivity };
  messages: ReadonlyArray<{ status: MessageStatus }>;
  unseen?: boolean;
  hadConnected?: boolean;
  failedUpload?: boolean;
};

export function liveActivity(state: LiveActivityInput): LiveActivity {
  if (state.error || state.connection === 'error' || state.failedUpload) {
    return 'error';
  }
  if (state.connection === 'connecting') {
    return state.hadConnected ? 'reconnecting' : 'connecting';
  }
  if (state.typing.activity !== 'idle') {
    return state.typing.activity;
  }
  if (state.messages.some((message) => message.status === 'sending')) {
    return 'sending';
  }
  if (state.unseen) {
    return 'unseen';
  }
  return 'idle';
}

export function liveActivityLabel(activity: LiveActivity): string {
  switch (activity) {
    case 'error':
      return 'Erro';
    case 'connecting':
      return 'Conectando';
    case 'reconnecting':
      return 'Reconectando';
    case 'sending':
      return 'Enviando…';
    case 'typing':
      return 'Digitando…';
    case 'recording-audio':
      return 'Gravando áudio…';
    case 'unseen':
      return 'Nova mensagem';
    case 'idle':
      return '';
    default: {
      const exhaustive: never = activity;
      return exhaustive;
    }
  }
}

export function liveActivityAnnouncement(activity: LiveActivity, viewingLive: boolean): string {
  if (viewingLive) {
    return '';
  }
  switch (activity) {
    case 'error':
    case 'reconnecting':
    case 'unseen':
      return liveActivityLabel(activity);
    case 'idle':
    case 'sending':
    case 'typing':
    case 'recording-audio':
    case 'connecting':
      return '';
    default: {
      const exhaustive: never = activity;
      return exhaustive;
    }
  }
}
