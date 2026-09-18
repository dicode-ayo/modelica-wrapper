/**
 * Single-slot task queue: tasks run one after another in submission order.
 *
 * The OMC channel uses one because its REQ/REP socket admits exactly one
 * round-trip at a time; the error-buffer turn queue uses one per client for
 * the same one-at-a-time guarantee. A task's failure is contained either way:
 * the queue keeps draining rather than poisoning every task behind it.
 */

export class SerialQueue {
  private tail: Promise<unknown> = Promise.resolve();

  /** Queue `task` behind everything already submitted; resolve with its result. */
  run<T>(task: () => Promise<T>): Promise<T> {
    const result = this.tail.then(task);
    // `tail` must never reject, or a single failed task would reject every
    // task queued after it when they await their predecessor.
    this.tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}
