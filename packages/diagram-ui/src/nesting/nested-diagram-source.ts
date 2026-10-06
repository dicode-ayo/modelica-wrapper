import type { DiagramLayout } from "@dicode/omc-client";
import { layoutDependsOn } from "@dicode/omc-client/layout";

import { LruCache } from "../lru-cache.js";

/** Fetches `className`'s own diagram layout, with that class as its root. */
export type NestedDiagramSource = (className: string) => Promise<DiagramLayout>;

/** Bound on the class layouts one layout element keeps resident. */
const CAPACITY = 64;

export interface SharedNestedSource {
  readonly fetch: NestedDiagramSource;
  /**
   * Forget every layout built from `className`'s definition; `null` forgets
   * all. A fetch in flight that may have read the old definition runs again.
   */
  invalidate(className: string | null): void;
}

/** Classes changed while one fetch was in flight; `null` stands for all. */
type Changed = Set<string | null>;

function readStale(layout: DiagramLayout, changed: Changed): boolean {
  if (changed.has(null)) return true;
  for (const className of changed) {
    if (className !== null && layoutDependsOn(layout, className)) return true;
  }
  return false;
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
  const byClass = new LruCache<string, Promise<DiagramLayout>>(capacity);
  const settled = new WeakMap<Promise<DiagramLayout>, DiagramLayout>();
  const inFlight = new Set<Changed>();

  const load = async (className: string): Promise<DiagramLayout> => {
    for (;;) {
      const changed: Changed = new Set();
      inFlight.add(changed);
      let layout: DiagramLayout;
      try {
        layout = await fetch(className);
      } finally {
        inFlight.delete(changed);
      }
      if (!readStale(layout, changed)) return layout;
    }
  };

  return {
    fetch: (className) => {
      const known = byClass.get(className);
      if (known !== undefined) return known;
      const pending = load(className);
      byClass.set(className, pending);
      pending.then(
        (layout) => settled.set(pending, layout),
        () => {
          if (byClass.get(className) === pending) byClass.delete(className);
        },
      );
      return pending;
    },
    invalidate: (className) => {
      for (const changed of inFlight) changed.add(className);
      for (const [key, pending] of [...byClass.entries()]) {
        const layout = settled.get(pending);
        if (
          layout !== undefined &&
          (className === null || layoutDependsOn(layout, className))
        ) {
          byClass.delete(key);
        }
      }
    },
  };
}
