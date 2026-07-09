import { describe, expect, it } from "vitest";

import { SerialQueue } from "./queue.js";

const deferred = <T>(): {
  promise: Promise<T>;
  resolve: (v: T) => void;
} => {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
};

describe("SerialQueue", () => {
  it("runs one task at a time, in submission order", async () => {
    const queue = new SerialQueue();
    const running: number[] = [];
    let concurrent = 0;
    let peak = 0;

    const task = (id: number) => async (): Promise<number> => {
      concurrent++;
      peak = Math.max(peak, concurrent);
      await Promise.resolve();
      running.push(id);
      concurrent--;
      return id;
    };

    const results = await Promise.all([
      queue.run(task(1)),
      queue.run(task(2)),
      queue.run(task(3)),
    ]);

    expect(results).toEqual([1, 2, 3]);
    expect(running).toEqual([1, 2, 3]);
    expect(peak).toBe(1);
  });

  it("does not start a task before its predecessor settles", async () => {
    const queue = new SerialQueue();
    const gate = deferred<void>();
    let secondStarted = false;

    const first = queue.run(async () => {
      await gate.promise;
      return "first";
    });
    const second = queue.run(async () => {
      secondStarted = true;
      return "second";
    });

    await Promise.resolve();
    expect(secondStarted).toBe(false);

    gate.resolve();
    await expect(first).resolves.toBe("first");
    await expect(second).resolves.toBe("second");
  });

  it("keeps draining after a task rejects", async () => {
    const queue = new SerialQueue();

    const failed = queue.run(() => Promise.reject(new Error("boom")));
    const after = queue.run(() => Promise.resolve("survived"));

    await expect(failed).rejects.toThrow("boom");
    await expect(after).resolves.toBe("survived");
  });
});
