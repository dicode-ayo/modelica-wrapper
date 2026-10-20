import { describe, expect, it } from "vitest";

import { createEventScheduler } from "./mo-event-scheduler.js";

interface Deferred {
  promise: Promise<void>;
  resolve: () => void;
}

function deferred(): Deferred {
  let resolve: () => void = () => {};
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

const flush = async (): Promise<void> => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
};

function setup(ready: () => Promise<void> = () => Promise.resolve()) {
  const errors: Array<[string, unknown]> = [];
  const scheduler = createEventScheduler({
    ready,
    onError: (p, err) => errors.push([p, err]),
  });
  const started: string[] = [];
  const gates = new Map<string, Deferred>();
  const queue = (key: string, name: string, describedPath = name): void => {
    const gate = deferred();
    gates.set(name, gate);
    scheduler.run(key, describedPath, async () => {
      started.push(name);
      await gate.promise;
    });
  };
  const finish = async (name: string): Promise<void> => {
    gates.get(name)?.resolve();
    await flush();
  };
  return { scheduler, errors, started, queue, finish };
}

describe("seed gate", () => {
  it("does not start an event until ready resolves", async () => {
    const seed = deferred();
    const t = setup(() => seed.promise);
    t.queue("/ws/A/package.mo", "a");
    await flush();
    expect(t.started).toEqual([]);
    seed.resolve();
    await flush();
    expect(t.started).toEqual(["a"]);
  });

  it("re-reads ready per event so a later-enqueued seed gates it", async () => {
    let current = Promise.resolve();
    const t = setup(() => current);
    t.queue("/ws/A/package.mo", "a");
    await flush();
    expect(t.started).toEqual(["a"]);
    const seed = deferred();
    current = seed.promise;
    t.queue("/ws/B/package.mo", "b");
    await flush();
    expect(t.started).toEqual(["a"]);
    seed.resolve();
    await flush();
    expect(t.started).toEqual(["a", "b"]);
  });
});

describe("conflict ordering", () => {
  it("serializes equal keys in FIFO order", async () => {
    const t = setup();
    t.queue("/ws/A/package.mo", "1");
    t.queue("/ws/A/package.mo", "2");
    t.queue("/ws/A/package.mo", "3");
    await flush();
    expect(t.started).toEqual(["1"]);
    await t.finish("1");
    expect(t.started).toEqual(["1", "2"]);
    await t.finish("2");
    expect(t.started).toEqual(["1", "2", "3"]);
  });

  it("serializes a parent package key against nested package and member keys", async () => {
    const t = setup();
    t.queue("/ws/Pkg/package.mo", "parent");
    t.queue("/ws/Pkg/Sub/package.mo", "child");
    t.queue("/ws/Pkg/package.mo", "member");
    await flush();
    expect(t.started).toEqual(["parent"]);
    await t.finish("parent");
    expect(t.started).toEqual(["parent", "child"]);
    await t.finish("child");
    expect(t.started).toEqual(["parent", "child", "member"]);
  });

  it("serializes a nested child that was queued before its parent", async () => {
    const t = setup();
    t.queue("/ws/Pkg/Sub/package.mo", "child");
    t.queue("/ws/Pkg/package.mo", "parent");
    await flush();
    expect(t.started).toEqual(["child"]);
    await t.finish("child");
    expect(t.started).toEqual(["child", "parent"]);
  });

  it("does not treat a name-prefix sibling directory as nested", async () => {
    const t = setup();
    t.queue("/ws/Pkg/package.mo", "a");
    t.queue("/ws/Pkg2/package.mo", "b");
    await flush();
    expect(t.started).toEqual(["a", "b"]);
  });

  it("runs sibling packages and unrelated directories concurrently", async () => {
    const t = setup();
    t.queue("/ws/A/package.mo", "a");
    t.queue("/ws/B/package.mo", "b");
    t.queue("/other/c/package.mo", "c");
    await flush();
    expect(t.started).toEqual(["a", "b", "c"]);
  });

  it("waits for every conflicting earlier event, not just the last", async () => {
    const t = setup();
    t.queue("/ws/Pkg/A/package.mo", "a");
    t.queue("/ws/Pkg/B/package.mo", "b");
    t.queue("/ws/Pkg/package.mo", "parent");
    await flush();
    expect(t.started).toEqual(["a", "b"]);
    await t.finish("a");
    expect(t.started).toEqual(["a", "b"]);
    await t.finish("b");
    expect(t.started).toEqual(["a", "b", "parent"]);
  });
});

describe("failure handling", () => {
  it("reports a rejecting fn with its described path and keeps later events running", async () => {
    const t = setup();
    const boom = new Error("boom");
    t.scheduler.run("/ws/A/package.mo", "/ws/A/Model.mo", () =>
      Promise.reject(boom),
    );
    t.queue("/ws/A/package.mo", "next");
    await flush();
    expect(t.errors).toEqual([["/ws/A/Model.mo", boom]]);
    expect(t.started).toEqual(["next"]);
  });

  it("does not re-report a failure on events that waited behind it", async () => {
    const t = setup();
    t.scheduler.run("/ws/A/package.mo", "x", () =>
      Promise.reject(new Error("e")),
    );
    t.queue("/ws/A/package.mo", "n1");
    t.queue("/ws/A/package.mo", "n2");
    await t.finish("n1");
    await t.finish("n2");
    expect(t.errors).toHaveLength(1);
    expect(t.started).toEqual(["n1", "n2"]);
  });
});
