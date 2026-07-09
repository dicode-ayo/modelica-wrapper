/**
 * Single-slot task queue for the OMC channel.
 *
 * OMC's REQ/REP socket admits exactly one round-trip at a time, so tasks run
 * one after another in submission order. A task's failure is contained: the
 * queue keeps draining rather than poisoning every task behind it.
 */

export class SerialQueue {
  private tail: Promise<unknown> = Promise.resolve();

  /** Queue `task` behind everything already submitted; resolve with its result. */
  run<T>(task: () => Promise<T>): Promise<T> {
    const result = this.tail.then(task, task);
    // `tail` must never reject, or a single failed task would reject every
    // task queued after it when they await their predecessor.
    this.tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}
