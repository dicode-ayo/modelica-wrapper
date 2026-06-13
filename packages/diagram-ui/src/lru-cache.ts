/**
 * Bounded LRU cache backed by a Map. JS Map preserves insertion order, so the
 * head is always the least-recently-used entry: on every read the entry is
 * moved to the tail, and on every write that exceeds capacity the head is
 * evicted via the `onEvict` callback before the new entry is appended.
 */
export class LruCache<K, V> {
  private readonly map = new Map<K, V>();

  constructor(
    readonly capacity: number,
    private readonly onEvict?: (key: K, value: V) => void,
  ) {}

  get(key: K): V | undefined {
    const value = this.map.get(key);
    if (value === undefined) {
      return undefined;
    }
    this.map.delete(key);
    this.map.set(key, value);
    return value;
  }

  set(key: K, value: V): void {
    if (this.map.has(key)) {
      this.map.delete(key);
    } else if (this.map.size >= this.capacity) {
      this.evictOne();
    }
    this.map.set(key, value);
  }

  delete(key: K): boolean {
    return this.map.delete(key);
  }

  values(): IterableIterator<V> {
    return this.map.values();
  }

  get size(): number {
    return this.map.size;
  }

  clear(): void {
    this.map.clear();
  }

  private evictOne(): void {
    const first = this.map.keys().next();
    if (first.done) {
      return;
    }
    const key = first.value;
    const value = this.map.get(key);
    this.map.delete(key);
    if (value !== undefined) {
      this.onEvict?.(key, value);
    }
  }
}
