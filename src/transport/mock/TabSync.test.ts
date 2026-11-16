import { FakeBus } from '../../test/fakeBroadcastChannel';
import { createTabSync, noopTabSync, TAB_SYNC_CHANNEL, type ChannelLike, type TabSyncMessage } from './TabSync';
import { ICS_TENANT_ID, ICS_USERS } from './seed';

const message: TabSyncMessage = {
  kind: 'deliveries',
  deliveries: [
    {
      to: ICS_USERS.bruno,
      event: { type: 'typing', tenantId: ICS_TENANT_ID, conversationId: 'dm:x' as never, userId: ICS_USERS.carla, isTyping: true },
    },
  ],
};

describe('TabSync', () => {
  it('uma aba posta e a outra recebe uma cópia; quem postou não recebe de volta', () => {
    const bus = new FakeBus();
    const a = createTabSync(bus.factory);
    const b = createTabSync(bus.factory);
    const fromA: TabSyncMessage[] = [];
    const fromB: TabSyncMessage[] = [];
    a.subscribe((item) => fromA.push(item));
    b.subscribe((item) => fromB.push(item));
    a.post(message);
    expect(fromB).toEqual([message]);
    expect(fromB[0]).not.toBe(message);
    expect(fromA).toEqual([]);
  });

  it('usa o canal sm-webchat-mock-v2 e canais de outro nome não se misturam', () => {
    const bus = new FakeBus();
    const a = createTabSync(bus.factory);
    const other = createTabSync(bus.factory, 'outro-canal');
    const received: TabSyncMessage[] = [];
    other.subscribe((item) => received.push(item));
    a.post(message);
    expect(received).toEqual([]);
    expect(TAB_SYNC_CHANNEL).toBe('sm-webchat-mock-v2');
  });

  it('cancelar a assinatura e fechar param a entrega', () => {
    const bus = new FakeBus();
    const a = createTabSync(bus.factory);
    const b = createTabSync(bus.factory);
    const received: TabSyncMessage[] = [];
    const stop = b.subscribe((item) => received.push(item));
    a.post(message);
    stop();
    a.post(message);
    expect(received).toHaveLength(1);
    b.subscribe((item) => received.push(item));
    b.close();
    a.post(message);
    expect(received).toHaveLength(1);
  });

  it('ignora lixo que não é mensagem de sincronização', () => {
    const bus = new FakeBus();
    const a = createTabSync(bus.factory);
    const raw = bus.factory(TAB_SYNC_CHANNEL);
    const received: TabSyncMessage[] = [];
    a.subscribe((item) => received.push(item));
    raw.postMessage('lixo');
    raw.postMessage({ kind: 'outra-coisa' });
    raw.postMessage({ kind: 'deliveries' });
    expect(received).toEqual([]);
  });

  it('sem BroadcastChannel (jsdom) cai num no-op que não lança', () => {
    vi.stubGlobal('BroadcastChannel', undefined);
    try {
      const sync = createTabSync();
      expect(sync).toBe(noopTabSync);
      const received: TabSyncMessage[] = [];
      const stop = sync.subscribe((item) => received.push(item));
      expect(() => {
        sync.post(message);
        stop();
        sync.close();
      }).not.toThrow();
      expect(received).toEqual([]);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('com um BroadcastChannel global presente, é ele que é usado', () => {
    const bus = new FakeBus();
    const Ctor = function (name: string) {
      return bus.factory(name);
    } as unknown as new (name: string) => ChannelLike;
    vi.stubGlobal('BroadcastChannel', Ctor);
    try {
      const a = createTabSync();
      const b = createTabSync();
      const received: TabSyncMessage[] = [];
      b.subscribe((item) => received.push(item));
      a.post(message);
      expect(received).toHaveLength(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

