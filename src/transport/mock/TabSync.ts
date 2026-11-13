import type { Delivery } from './MockServer';

/** Mensagem entre abas do mesmo perfil: o que a aba que escreveu entregou. */
export type TabSyncMessage = { readonly kind: 'deliveries'; readonly deliveries: readonly Delivery[] };

export interface TabSync {
  post(message: TabSyncMessage): void;
  subscribe(handler: (message: TabSyncMessage) => void): () => void;
  close(): void;
}

/** O mínimo de `BroadcastChannel` que usamos (injetável nos testes). */
export interface ChannelLike {
  postMessage(message: unknown): void;
  addEventListener(type: 'message', listener: (event: { data: unknown }) => void): void;
  removeEventListener(type: 'message', listener: (event: { data: unknown }) => void): void;
  close(): void;
}

export type ChannelFactory = (name: string) => ChannelLike;

export const TAB_SYNC_CHANNEL = 'sm-webchat-mock-v2';

export const noopTabSync: TabSync = {
  post() {},
  subscribe() {
    return () => {};
  },
  close() {},
};

function browserChannelFactory(): ChannelFactory | undefined {
  const Ctor = (globalThis as { BroadcastChannel?: new (name: string) => ChannelLike }).BroadcastChannel;
  return Ctor ? (name) => new Ctor(name) : undefined;
}

function isTabSyncMessage(data: unknown): data is TabSyncMessage {
  return (
    typeof data === 'object' &&
    data !== null &&
    (data as { kind?: unknown }).kind === 'deliveries' &&
    Array.isArray((data as { deliveries?: unknown }).deliveries)
  );
}

/** BroadcastChannel entre abas; sem `BroadcastChannel` (jsdom) cai num no-op. */
export function createTabSync(
  factory: ChannelFactory | undefined = browserChannelFactory(),
  name: string = TAB_SYNC_CHANNEL,
): TabSync {
  if (!factory) {
    return noopTabSync;
  }
  const channel = factory(name);
  return {
    post(message) {
      channel.postMessage(message);
    },
    subscribe(handler) {
      const listener = (event: { data: unknown }) => {
        if (isTabSyncMessage(event.data)) {
          handler(event.data);
        }
      };
      channel.addEventListener('message', listener);
      return () => {
        channel.removeEventListener('message', listener);
      };
    },
    close() {
      channel.close();
    },
  };
}
