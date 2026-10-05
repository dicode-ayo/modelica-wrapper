import type { DiagramLayout } from "@dicode/omc-client";

import { LruCache } from "../lru-cache.js";

/** Fetches `className`'s own diagram layout, with that class as its root. */
export type NestedDiagramSource = (className: string) => Promise<DiagramLayout>;

/** Bound on the class layouts one layout element keeps resident. */
const CAPACITY = 64;

/**
 * Wraps `fetch` so every box of one class shares one request, in flight or
 * settled, for the most recent `capacity` classes. A rejected fetch is
 * forgotten so the next approach retries it.
 */
export function sharedNestedSource(
  fetch: NestedDiagramSource,
  capacity = CAPACITY,
): NestedDiagramSource {
  const byClass = new LruCache<string, Promise<DiagramLayout>>(capacity);
  return (className) => {
    const known = byClass.get(className);
    if (known !== undefined) return known;
    const pending = fetch(className);
    byClass.set(className, pending);
    pending.catch(() => {
      if (byClass.get(className) === pending) byClass.delete(className);
    });
    return pending;
  };
}
