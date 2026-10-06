/**
 * Class-keyed cache of nested diagram layouts — the semantic in-place
 * nesting zoom feature (issue #629). A component's box, once it earns the
 * `openable` flag `producer.ts` computes, fetches its CLASS's own diagram
 * (that class as its own root, not derived from the already-open class's
 * sub-tree — see issue #628 for why the derived path resolves no
 * connections) and shows it inside the box. Keyed on class name rather than
 * instance name: one `Inertia` fetch serves every `Inertia` instance on the
 * canvas, in this editor or another.
 *
 * Session-scoped and keyed off the `OmcClient` via a module-level `WeakMap`,
 * mirroring `sessionUnitCache` (`unit-table.ts`) — every diagram editor
 * sharing a client shares the cache, and a new client (new OMC session)
 * gets a fresh one.
 */

import {
  layoutDependsOn,
  type DiagramLayout,
  type OmcClient,
} from "@dicode/omc-client";
import { LruCache } from "@dicode/diagram-ui/lru-cache";

import { fetchDiagramLayout } from "./open-diagram.js";

/**
 * Bounded so a diagram with many distinct nested classes can't grow this
 * without limit; generous enough that a deep hierarchy's classes all stay
 * warm across an editing session.
 */
const CAPACITY = 64;

export class NestedDiagramCache {
  private readonly layouts: LruCache<string, DiagramLayout>;
  /**
   * In-flight fetches, keyed by class name. Two components of the same type
   * clearing the zoom threshold in the same frame must share one fetch
   * rather than issuing a duplicate OMC round trip each.
   */
  private readonly pending = new Map<string, Promise<DiagramLayout>>();
  /** Bumped by every invalidation, so a fetch that straddles one is not cached. */
  private generation = 0;

  constructor(
    private readonly client: OmcClient,
    private readonly fetch: (
      client: OmcClient,
      className: string,
    ) => Promise<DiagramLayout> = fetchDiagramLayout,
    capacity = CAPACITY,
  ) {
    this.layouts = new LruCache(capacity);
  }

  /** `className`'s own diagram layout, cached for the session. */
  async get(className: string): Promise<DiagramLayout> {
    const hit = this.layouts.get(className);
    if (hit !== undefined) return hit;
    const inFlight = this.pending.get(className);
    if (inFlight !== undefined) return inFlight;
    const promise = this.load(className);
    this.pending.set(className, promise);
    try {
      return await promise;
    } finally {
      if (this.pending.get(className) === promise) {
        this.pending.delete(className);
      }
    }
  }

  /**
   * Drop every layout built from `className`'s definition — its own, and
   * any that draws it as a sub-component, port, or ancestor. An in-flight
   * fetch may already have read the old definition, so it is dropped too.
   */
  invalidate(className: string): void {
    this.generation += 1;
    this.pending.clear();
    for (const [key, layout] of [...this.layouts.entries()]) {
      if (layoutDependsOn(layout, className)) this.layouts.delete(key);
    }
  }

  /** Drop everything, for a change no class name describes. */
  clear(): void {
    this.generation += 1;
    this.pending.clear();
    this.layouts.clear();
  }

  // A rejection is not cached — `pending` is cleared in `get`'s `finally`
  // either way, and `layouts.set` only runs on success — so a transient OMC
  // failure doesn't poison every later zoom into the same class.
  private async load(className: string): Promise<DiagramLayout> {
    const generation = this.generation;
    const layout = await this.fetch(this.client, className);
    if (generation === this.generation) this.layouts.set(className, layout);
    return layout;
  }
}

const caches = new WeakMap<OmcClient, NestedDiagramCache>();

/** Get (or lazily create) the session-level nested-diagram cache for `client`. */
export function nestedDiagramCache(client: OmcClient): NestedDiagramCache {
  let cache = caches.get(client);
  if (cache === undefined) {
    cache = new NestedDiagramCache(client);
    caches.set(client, cache);
  }
  return cache;
}
