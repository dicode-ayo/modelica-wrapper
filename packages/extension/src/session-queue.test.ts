import { describe, expect, it, vi } from "vitest";

import { SessionQueue } from "./session-queue.js";

describe("SessionQueue", () => {
  it("runs enqueued tasks one after another, in append order", async () => {
    const queue = new SessionQueue();
    const order: number[] = [];
    let resolveFirst: (() => void) | undefined;
    const first = new Promise<void>((resolve) => {
      resolveFirst = resolve;
    });

    queue.enqueue(async () => {
      order.push(1);
      await first;
      order.push(2);
    });
    queue.enqueue(async () => {
      order.push(3);
    });

    // The second task must not start before the first awaits past its gate.
    await Promise.resolve();
    await Promise.resolve();
    expect(order).toEqual([1]);

    resolveFirst?.();
    await queue.current;

    expect(order).toEqual([1, 2, 3]);
  });

  it("does not poison the chain when a queued task rejects", async () => {
    const queue = new SessionQueue();
    const later = vi.fn().mockResolvedValue(undefined);

    queue.enqueue(() => Promise.reject(new Error("task exploded")));
    queue.enqueue(later);

    await expect(queue.current).resolves.toBeUndefined();
    expect(later).toHaveBeenCalledTimes(1);

    // A task enqueued after the chain has already absorbed a rejection
    // still runs — the tail stays healthy indefinitely, not just once.
    const afterward = vi.fn().mockResolvedValue(undefined);
    queue.enqueue(afterward);
    await queue.current;

    expect(afterward).toHaveBeenCalledTimes(1);
  });

  it("absorbs a rejection from the constructor's initial promise", async () => {
    const queue = new SessionQueue(Promise.reject(new Error("seed failed")));
    const task = vi.fn().mockResolvedValue(undefined);

    queue.enqueue(task);

    await expect(queue.current).resolves.toBeUndefined();
    expect(task).toHaveBeenCalledTimes(1);
  });
});
