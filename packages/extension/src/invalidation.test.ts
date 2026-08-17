import { describe, expect, it, vi } from "vitest";
import type * as vscode from "vscode";

import { ClassInvalidationRegistry, SessionQueue } from "./invalidation.js";

describe("ClassInvalidationRegistry", () => {
  it("fans one change out to every registered listener", () => {
    const registry = new ClassInvalidationRegistry();
    const first = vi.fn();
    const second = vi.fn();
    registry.register(first);
    registry.register(second);

    registry.classChanged("Lib.A");

    expect(first.mock.calls).toEqual([["Lib.A"]]);
    expect(second.mock.calls).toEqual([["Lib.A"]]);
  });

  it("stops delivering to a disposed listener", () => {
    const registry = new ClassInvalidationRegistry();
    const listener = vi.fn();
    registry.register(listener).dispose();

    registry.classChanged("Lib.A");

    expect(listener).not.toHaveBeenCalled();
  });

  it("keeps fanning out past a listener that throws", () => {
    const registry = new ClassInvalidationRegistry();
    const later = vi.fn();
    registry.register(() => {
      throw new Error("cache exploded");
    });
    registry.register(later);

    expect(() => registry.classChanged("Lib.A")).not.toThrow();
    expect(later).toHaveBeenCalledWith("Lib.A");
  });

  it("does not deliver the in-progress change to a listener registered during it", () => {
    const registry = new ClassInvalidationRegistry();
    const late = vi.fn();
    registry.register(() => {
      registry.register(late);
    });

    registry.classChanged("Lib.A");

    expect(late).not.toHaveBeenCalled();
  });

  it("still delivers the in-progress change to a listener disposed during it", () => {
    const registry = new ClassInvalidationRegistry();
    const doomed = vi.fn();
    const later: vscode.Disposable[] = [];
    registry.register(() => {
      for (const subscription of later) subscription.dispose();
    });
    later.push(registry.register(doomed));

    registry.classChanged("Lib.A");

    expect(doomed).toHaveBeenCalledWith("Lib.A");
  });

  it("fans sessionReplaced out to every registered listener, independently of classChanged", () => {
    const registry = new ClassInvalidationRegistry();
    const classListener = vi.fn();
    const sessionListener = vi.fn();
    registry.register(classListener);
    registry.registerSessionReplaced(sessionListener);

    registry.sessionReplaced();

    expect(sessionListener).toHaveBeenCalledTimes(1);
    expect(classListener).not.toHaveBeenCalled();
  });

  it("stops delivering sessionReplaced to a disposed listener", () => {
    const registry = new ClassInvalidationRegistry();
    const listener = vi.fn();
    registry.registerSessionReplaced(listener).dispose();

    registry.sessionReplaced();

    expect(listener).not.toHaveBeenCalled();
  });

  it("keeps fanning sessionReplaced out past a listener that throws", () => {
    const registry = new ClassInvalidationRegistry();
    const later = vi.fn();
    registry.registerSessionReplaced(() => {
      throw new Error("cache exploded");
    });
    registry.registerSessionReplaced(later);

    expect(() => registry.sessionReplaced()).not.toThrow();
    expect(later).toHaveBeenCalledTimes(1);
  });
});

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
