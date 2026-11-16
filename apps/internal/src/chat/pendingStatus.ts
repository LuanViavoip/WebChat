import type { MessageStatus } from '../domain/message';
import { mergeStatus } from './statusRank';

type PendingEntry = {
  status: MessageStatus;
  at: number;
};

export const DEFAULT_PENDING_LIMIT = 100;
export const DEFAULT_PENDING_TTL_MS = 5 * 60_000;

export class PendingStatusMap {
  private readonly entries = new Map<string, PendingEntry>();

  constructor(
    private readonly limit: number,
    private readonly ttlMs: number,
    private readonly now: () => number,
  ) {}

  get size(): number {
    this.prune();
    return this.entries.size;
  }

  add(id: string, status: MessageStatus): void {
    this.prune();
    const current = this.entries.get(id)?.status;
    const next = current ? mergeStatus(current, status) : status;
    this.entries.delete(id);
    this.entries.set(id, { status: next, at: this.now() });
    this.evictOverflow();
  }

  take(ids: Iterable<string>): MessageStatus | undefined {
    this.prune();
    let merged: MessageStatus | undefined;
    for (const id of new Set(ids)) {
      const entry = this.entries.get(id);
      if (!entry) {
        continue;
      }
      this.entries.delete(id);
      merged = merged ? mergeStatus(merged, entry.status) : entry.status;
    }
    return merged;
  }

  clear(): void {
    this.entries.clear();
  }

  private prune(): void {
    const cutoff = this.now() - this.ttlMs;
    for (const [id, entry] of this.entries) {
      if (entry.at <= cutoff) {
        this.entries.delete(id);
      }
    }
    this.evictOverflow();
  }

  private evictOverflow(): void {
    while (this.entries.size > this.limit) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) {
        return;
      }
      this.entries.delete(oldest);
    }
  }
}
