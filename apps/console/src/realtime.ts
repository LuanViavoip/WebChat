import type { Socket } from 'socket.io-client';

export type LinkState = 'connected' | 'reconnecting' | 'disconnected';

export function emitAck(socket: Socket, event: string, payload: unknown = {}): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), 8000);
    socket.emit(event, payload, (response: unknown) => {
      clearTimeout(timer);
      resolve(response);
    });
  });
}

export function ackMessage(parsed: { success: boolean; data?: unknown }, fallback: string): string {
  if (!parsed.success || !parsed.data || typeof parsed.data !== 'object') return fallback;
  if (!('ok' in parsed.data) || parsed.data.ok !== false) return fallback;
  if (!('error' in parsed.data) || !parsed.data.error || typeof parsed.data.error !== 'object') return fallback;
  if (!('message' in parsed.data.error) || typeof parsed.data.error.message !== 'string') return fallback;
  return parsed.data.error.message;
}
