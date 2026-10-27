import type { Socket } from 'socket.io';
import { describe, expect, it } from 'vitest';
import { afterSessionValidation, joinSessionRoom } from '../src/realtime/bind.js';
import { rooms } from '../src/realtime/rooms.js';

describe('rooms de sessão', () => {
  it('aguarda validação antes de entrar em salas que recebem eventos', async () => {
    const fake = fakeSocket();
    let resolveValidation!: (active: boolean) => void;
    const validation = new Promise<boolean>((resolve) => { resolveValidation = resolve; });
    const ready = joinSessionRoom(fake.socket, {
      sessionId: 'session-1',
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    }, () => validation);
    let enteredDataRoom = false;
    const entering = afterSessionValidation(fake.socket, ready, () => {
      enteredDataRoom = true;
      fake.socket.join(rooms.supervisorRefresh('tenant-example'));
      fake.socket.join('tenant:example:agent:example');
    });

    expect(fake.rooms).toEqual(['session:session-1']);
    expect(enteredDataRoom).toBe(false);
    resolveValidation(true);
    await entering;
    expect(fake.rooms).toEqual([
      'session:session-1',
      rooms.supervisorRefresh('tenant-example'),
      'tenant:example:agent:example',
    ]);
    fake.disconnect();
  });

  it('não entra em salas de dados se a validação revelar logout anterior ao join', async () => {
    const fake = fakeSocket();
    const ready = joinSessionRoom(fake.socket, {
      sessionId: 'session-revoked',
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    }, async () => false);
    let enteredDataRoom = false;
    await afterSessionValidation(fake.socket, ready, () => {
      enteredDataRoom = true;
      fake.socket.join(rooms.supervisorRefresh('tenant-example'));
    });
    expect(enteredDataRoom).toBe(false);
    expect(fake.rooms).toEqual(['session:session-revoked']);
    expect(fake.socket.connected).toBe(false);
  });
});

function fakeSocket() {
  const rooms: string[] = [];
  const listeners = new Map<string, () => void>();
  const socket = {
    connected: true,
    data: {},
    join: (room: string) => { rooms.push(room); },
    once: (event: string, listener: () => void) => { listeners.set(event, listener); },
    disconnect: () => { socket.connected = false; listeners.get('disconnect')?.(); },
  } as unknown as Socket;
  return { socket, rooms, disconnect: () => socket.disconnect(true) };
}
