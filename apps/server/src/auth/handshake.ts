import type { Socket } from 'socket.io';
import { DomainError } from '../domain/errors.js';

export function readHandshakeToken(socket: Socket): string {
  const auth: unknown = socket.handshake.auth;
  if (!auth || typeof auth !== 'object' || Array.isArray(auth)) {
    throw new DomainError('unauthorized', 'Sessão ausente');
  }
  const entries = Object.entries(auth as Record<string, unknown>);
  if (entries.length !== 1 || entries[0]?.[0] !== 'token') {
    throw new DomainError('unauthorized', 'Sessão ausente');
  }
  const token = entries[0][1];
  if (typeof token !== 'string' || token.length < 20 || token.length > 200) {
    throw new DomainError('unauthorized', 'Sessão ausente');
  }
  return token;
}

export function readBearer(header: string | undefined): string {
  if (!header?.startsWith('Bearer ')) {
    throw new DomainError('unauthorized', 'Sessão ausente');
  }
  const token = header.slice('Bearer '.length).trim();
  if (token.length < 20 || token.length > 200) {
    throw new DomainError('unauthorized', 'Sessão ausente');
  }
  return token;
}
