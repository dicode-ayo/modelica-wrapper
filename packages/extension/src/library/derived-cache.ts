/**
 * An invalidating memo whose entries declare the keys they were derived from.
 * Invalidating a key cascades to every entry that depends on it, and a compute
 * in flight when its key is invalidated can neither be joined nor write its
 * pre-invalidation value.
 */

import { log } from "../logger.js";

export interface Computed<K, V> {
  value: V;
  /** The keys `value` was derived from. `undefined` means the chain is unknown
   *  (a failed compute): the edges recorded by the last good compute stay. */
  dependsOn?: readonly K[] | undefined;
}

export interface DerivedCacheOptions<K extends string, V> {
  /** Log topic for the cache's debug lines. */
  topic: string;
  /** `fresh` is set when the key was invalidated since its last compute, so
   *  the source must be re-read rather than answered from its own cache. */
  compute(key: K, ctx: { fresh: boolean }): Promise<Computed<K, V>>;
  /** Defaults to caching every value, `undefined` included. */
  shouldCache?(value: V): boolean;
  /** Called once per invalidated key, cascaded keys included. */
  onInvalidate?(key: K): void;
}

interface Flight<V> {
  /** Identity token: a flight owns its key only while the map still holds it. */
  readonly owner: object;
  readonly promise: Promise<V>;
}

export class DerivedCache<K extends string, V> {
  private readonly entries = new Map<K, V>();
  private readonly inFlight = new Map<K, Flight<V>>();
  /** Keys invalidated since their last compute. The mark is consumed by the
   *  compute it triggers, and survives {@link clear}: it records an edit, not
   *  a cached value. */
  private readonly freshOnce = new Set<K>();
  /** Base key → the keys whose last compute depended on it. Edges are pruned
   *  on re-compute, not on eviction: a stale edge can only over-invalidate. */
  private readonly dependents = new Map<K, Set<K>>();
  private readonly dependsOn = new Map<K, readonly K[]>();
  private tick = 0;
  private readonly lastInvalidated = new Map<K, number>();

  constructor(private readonly options: DerivedCacheOptions<K, V>) {}

  /** Concurrent callers for one key share a single compute. */
  get(key: K): Promise<V> {
    if (this.entries.has(key)) {
      log.debug(this.options.topic, `cache hit ${key}`);
      return Promise.resolve(this.entries.get(key) as V);
    }
    const joined = this.inFlight.get(key);
    if (joined) {
      log.debug(this.options.topic, `joining in-flight compute ${key}`);
      return joined.promise;
    }
    return this.start(key);
  }

  /** Evict `key` and every entry derived from it. */
  invalidate(key: K): void {
    this.invalidateOne(key);
    for (const dependent of this.dependents.get(key) ?? []) {
      this.invalidateOne(dependent);
    }
  }

  /** Drop every value and disown every compute in flight. Returns how many
   *  values were dropped. */
  clear(): number {
    const dropped = this.entries.size;
    this.entries.clear();
    this.inFlight.clear();
    return dropped;
  }

  private invalidateOne(key: K): void {
    this.entries.delete(key);
    this.inFlight.delete(key);
    this.freshOnce.add(key);
    this.lastInvalidated.set(key, ++this.tick);
    this.options.onInvalidate?.(key);
  }

  private start(key: K): Promise<V> {
    // Consumed on start only: a cache hit serves bytes from before the
    // invalidation's re-read and a join rides a compute already under way.
    const fresh = this.freshOnce.delete(key);
    // Snapshot before the compute: a base invalidated past this tick may
    // predate the value computed, and its edge does not exist yet to cascade.
    const startTick = this.tick;
    const owner = {};
    const promise = this.settle(key, owner, fresh, startTick).finally(() => {
      if (this.owns(key, owner)) this.inFlight.delete(key);
    });
    this.inFlight.set(key, { owner, promise });
    return promise;
  }

  private async settle(
    key: K,
    owner: object,
    fresh: boolean,
    startTick: number,
  ): Promise<V> {
    const { value, dependsOn } = await this.options.compute(key, { fresh });
    if (!this.owns(key, owner)) return value;
    if (this.options.shouldCache?.(value) ?? true) this.entries.set(key, value);
    if (dependsOn === undefined) return value;
    this.recordDependencies(key, dependsOn);
    // A base edited mid-compute missed the cascade; now that its edge exists,
    // drop the possibly-stale value so the next read recomputes.
    if (dependsOn.some((b) => (this.lastInvalidated.get(b) ?? 0) > startTick)) {
      this.invalidateOne(key);
    }
    return value;
  }

  private owns(key: K, owner: object): boolean {
    return this.inFlight.get(key)?.owner === owner;
  }

  private recordDependencies(key: K, bases: readonly K[]): void {
    for (const base of this.dependsOn.get(key) ?? []) {
      this.dependents.get(base)?.delete(key);
    }
    this.dependsOn.set(key, bases);
    for (const base of bases) {
      let set = this.dependents.get(base);
      if (set === undefined) {
        set = new Set();
        this.dependents.set(base, set);
      }
      set.add(key);
    }
  }
}
