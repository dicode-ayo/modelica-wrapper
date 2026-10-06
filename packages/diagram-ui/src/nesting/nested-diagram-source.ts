import { layoutDependsOn, type DiagramLayout } from "@dicode/omc-client";

import { LruCache } from "../lru-cache.js";

/** Fetches `className`'s own diagram layout, with that class as its root. */
export type NestedDiagramSource = (className: string) => Promise<DiagramLayout>;

/** Bound on the class layouts one layout element keeps resident. */
const CAPACITY = 64;

export interface SharedNestedSource {
  readonly fetch: NestedDiagramSource;
  /**
   * Forget every layout built from `className`'s definition, and every fetch
   * still in flight, which may have read the old one. `null` forgets all.
   */
  invalidate(className: string | null): void;
}

interface Entry {
  readonly pending: Promise<DiagramLayout>;
  layout?: DiagramLayout;
}

/**
 * Wraps `fetch` so every box of one class shares one request, in flight or
 * settled, for the most recent `capacity` classes. A rejected fetch is
 * forgotten so the next approach retries it.
 */
export function sharedNestedSource(
  fetch: NestedDiagramSource,
  capacity = CAPACITY,
): SharedNestedSource {
  const byClass = new LruCache<string, Entry>(capacity);
  return {
    fetch: (className) => {
      const known = byClass.get(className);
      if (known !== undefined) return known.pending;
      const entry: Entry = { pending: fetch(className) };
      byClass.set(className, entry);
      entry.pending.then(
        (layout) => {
          entry.layout = layout;
        },
        () => {
          if (byClass.get(className) === entry) byClass.delete(className);
        },
      );
      return entry.pending;
    },
    invalidate: (className) => {
      for (const [key, { layout }] of [...byClass.entries()]) {
        if (
          className === null ||
          layout === undefined ||
          layoutDependsOn(layout, className)
        ) {
          byClass.delete(key);
        }
      }
    },
  };
}
