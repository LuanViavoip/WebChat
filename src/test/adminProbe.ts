import type { ChatEvent, ConnectRequest } from '../transport/ChatTransport';
import { MockBackend } from '../transport/mock/MockBackend';
import { MemoryMockStore } from '../transport/mock/MockStore';
import { MockTransport } from '../transport/mock/MockTransport';
import { createTabSync } from '../transport/mock/TabSync';
import type { FakeBus } from './fakeBroadcastChannel';

/** Um cliente conectado que guarda TODO evento recebido depois do `connect` (inclusive de `connection`). */
export type Probe = { readonly transport: MockTransport; readonly events: ChatEvent[]; readonly session: ConnectRequest };

const NOW = '2026-11-16T12:00:00.000Z';

export class Lab {
  readonly store = new MemoryMockStore();
  private readonly backends: MockBackend[] = [];
  private readonly probes: Probe[] = [];
  private ids = 0;

  /** Uma "aba": servidor + transportes sobre o storage compartilhado. Com `bus`, avisa as outras abas dele. */
  tab(bus?: FakeBus): MockBackend {
    const backend = new MockBackend({
      store: this.store,
      now: () => NOW,
      ...(bus ? { tabSync: createTabSync(bus.factory) } : {}),
    });
    this.backends.push(backend);
    return backend;
  }

  async join(backend: MockBackend, session: ConnectRequest): Promise<Probe> {
    const transport = new MockTransport({ backend, delays: { connectMs: 0 } });
    const events: ChatEvent[] = [];
    transport.subscribe((event) => events.push(event));
    await transport.connect(session);
    events.length = 0;
    const probe = { transport, events, session };
    this.probes.push(probe);
    return probe;
  }

  uniqueName(prefix: string): string {
    this.ids += 1;
    return `${prefix} ${String(this.ids)}`;
  }

  close(): void {
    for (const probe of this.probes) {
      probe.transport.disconnect();
    }
    for (const backend of this.backends) {
      backend.close();
    }
  }
}

export const typesOf = (events: readonly ChatEvent[]): string[] => events.map((event) => event.type);
