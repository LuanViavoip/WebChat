import type { ChannelLike } from '../transport/mock/TabSync';

/** Substitui o BroadcastChannel: cada canal recebe uma cópia do que OUTRO canal do mesmo nome postou. */
type Listener = (event: { data: unknown }) => void;

/** Barramento em memória: cada canal recebe o que OUTRO canal do mesmo nome postou (como o BroadcastChannel). */
export class FakeBus {
  private readonly channels: FakeChannel[] = [];

  factory = (name: string): ChannelLike => {
    const channel = new FakeChannel(name, this);
    this.channels.push(channel);
    return channel;
  };

  broadcast(from: FakeChannel, message: unknown): void {
    for (const channel of this.channels) {
      if (channel !== from && channel.name === from.name && !channel.closed) {
        channel.receive(structuredClone(message));
      }
    }
  }
}

class FakeChannel implements ChannelLike {
  closed = false;
  private readonly listeners = new Set<Listener>();

  constructor(
    readonly name: string,
    private readonly bus: FakeBus,
  ) {}

  postMessage(message: unknown): void {
    this.bus.broadcast(this, message);
  }

  addEventListener(_type: 'message', listener: Listener): void {
    this.listeners.add(listener);
  }

  removeEventListener(_type: 'message', listener: Listener): void {
    this.listeners.delete(listener);
  }

  close(): void {
    this.closed = true;
  }

  receive(data: unknown): void {
    for (const listener of this.listeners) {
      listener({ data });
    }
  }
}
