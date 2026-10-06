import type { DiagramLayout } from "@dicode/omc-client";
import { layoutDependsOn } from "@dicode/omc-client/layout";

import { LruCache } from "../lru-cache.js";

/** `className`'s own diagram, with that class as root. */
export type NestedDiagramSource = (className: string) => Promise<DiagramLayout>;

const CAPACITY = 64;

export interface SharedNestedSource {
  readonly fetch: NestedDiagramSource;
  /** Forget layouts built from `className` (`null`: all); an affected fetch in flight re-runs. */
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

/** One request per class, shared by every box. A rejection is forgotten so the next approach retries. */
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
