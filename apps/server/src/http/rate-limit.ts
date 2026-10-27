export class SlidingWindowLimiter {
  private readonly hits = new Map<string, number[]>();

  constructor(private readonly windowMs: number) {}

  allow(key: string, limit: number): boolean {
    const now = Date.now();
    const recent = (this.hits.get(key) ?? []).filter((stamp) => now - stamp < this.windowMs);
    if (recent.length >= limit) {
      this.hits.set(key, recent);
      return false;
    }
    recent.push(now);
    this.hits.set(key, recent);
    return true;
  }
}
