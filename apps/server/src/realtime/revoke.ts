import type { Server } from 'socket.io';
import { rooms } from './rooms.js';

const staffNamespaces = ['/agent', '/supervisor'] as const;

export function revokeRealtimeSessions(io: Server, sessionIds: readonly string[]): void {
  for (const sessionId of sessionIds) {
    for (const namespace of staffNamespaces) {
      io.of(namespace).in(rooms.session(sessionId)).disconnectSockets(true);
    }
  }
}
