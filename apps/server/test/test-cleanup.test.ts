import { describe, expect, it, vi } from 'vitest';
import type { Socket } from 'socket.io-client';
import { closeTestSockets, trackTestSocket } from './helpers.js';

describe('limpeza de conexões de teste', () => {
  it('desconecta todas as conexões registradas, inclusive após falha', () => {
    const first = { disconnect: vi.fn() } as unknown as Socket;
    const second = { disconnect: vi.fn() } as unknown as Socket;
    trackTestSocket(first);
    trackTestSocket(second);
    closeTestSockets();
    expect(first.disconnect).toHaveBeenCalledOnce();
    expect(second.disconnect).toHaveBeenCalledOnce();
    closeTestSockets();
    expect(first.disconnect).toHaveBeenCalledOnce();
  });
});
