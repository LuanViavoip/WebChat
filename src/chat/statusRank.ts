import type { MessageStatus } from '../domain/message';

const FORWARD: MessageStatus[] = ['sending', 'sent', 'delivered', 'read'];

export function mergeStatus(current: MessageStatus, incoming: MessageStatus): MessageStatus {
  if (incoming === 'error') {
    return 'error';
  }
  if (current === 'error') {
    return 'error';
  }
  return FORWARD.indexOf(incoming) >= FORWARD.indexOf(current) ? incoming : current;
}
