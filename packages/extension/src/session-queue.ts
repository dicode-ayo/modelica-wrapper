/**
 * A generic async task-serialization primitive: {@link SessionQueue}. No
 * dependency on class invalidation or `sessionReplaced` — it's a plain
 * promise-chaining queue that `mo-file-watcher.ts` and `workspace-autoload.ts`
 * each happen to use to serialize their own reactions to that signal.
 */

import { errorDetail } from "./error-detail.js";
import { log } from "./logger.js";

/**
 * A promise chain serializing tasks appended via {@link enqueue}, so each
 * starts only after every previously queued one has settled. A task that
 * rejects is logged and absorbed rather than left in the chain: a poisoned
 * tail would silently drop every task queued after it, and every caller
 * waiting on {@link current} with them. {@link current} is the tail, so a
 * caller reading it waits on whatever is queued as of now, not on what was
 * queued when it first read the chain.
 */
export class SessionQueue {
  private tail: Promise<void>;

  constructor(initial: Promise<void> = Promise.resolve()) {
    this.tail = SessionQueue.absorb(initial);
  }

  enqueue(task: () => Promise<void>): void {
    this.tail = SessionQueue.absorb(this.tail.then(task));
  }

  get current(): Promise<void> {
    return this.tail;
  }

  private static absorb(chained: Promise<void>): Promise<void> {
    return chained.catch((err) => {
      log.warn("sessionQueue", `a queued task threw: ${errorDetail(err)}`);
    });
  }
}
