export class IdAliasIndex {
  private readonly parent = new Map<string, string>();

  clear(): void {
    this.parent.clear();
  }

  link(a: string | undefined, b: string | undefined): void {
    if (!a || !b || a === b) {
      return;
    }
    const rootA = this.root(a);
    const rootB = this.root(b);
    if (rootA !== rootB) {
      this.parent.set(rootB, rootA);
    }
  }

  root(id: string): string {
    let current = id;
    const seen: string[] = [];
    while (this.parent.has(current)) {
      const next = this.parent.get(current);
      if (!next || next === current) {
        break;
      }
      seen.push(current);
      current = next;
    }
    for (const node of seen) {
      this.parent.set(node, current);
    }
    if (!this.parent.has(id)) {
      this.parent.set(id, current);
    }
    return current;
  }

  group(id: string): string[] {
    const root = this.root(id);
    const ids = new Set<string>([id, root]);
    for (const [key, value] of this.parent) {
      if (this.root(key) === root || this.root(value) === root) {
        ids.add(key);
        ids.add(value);
      }
    }
    return [...ids];
  }
}
