import type { MessageStatus } from '../domain/message';
import type { TransportStatus } from '../transport/ChatTransport';

export type LiveActivity = 'idle' | 'sending' | 'typing' | 'connecting' | 'error';

export type LiveActivityInput = {
  error: string | null;
  connection: TransportStatus;
  typing: { isTyping: boolean };
  messages: ReadonlyArray<{ status: MessageStatus }>;
};

export function liveActivity(state: LiveActivityInput): LiveActivity {
  if (state.error || state.connection === 'error') {
    return 'error';
  }
  if (state.connection === 'connecting') {
    return 'connecting';
  }
  if (state.typing.isTyping) {
    return 'typing';
  }
  if (state.messages.some((message) => message.status === 'sending')) {
    return 'sending';
  }
  return 'idle';
}

export function liveActivityLabel(activity: LiveActivity): string {
  switch (activity) {
    case 'error':
      return 'Erro';
    case 'connecting':
      return 'Reconectando';
    case 'sending':
      return 'Enviando…';
    case 'typing':
      return 'Digitando…';
    case 'idle':
      return '';
    default: {
      const exhaustive: never = activity;
      return exhaustive;
    }
  }
}
