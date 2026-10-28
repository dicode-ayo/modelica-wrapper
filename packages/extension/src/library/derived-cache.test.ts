import { describe, expect, it, vi } from "vitest";

import { DerivedCache, type Computed } from "./derived-cache.js";

interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
}

function deferred<T>(): Deferred<T> {
  let resolve: (value: T) => void = () => {};
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

/** A cache whose computes are driven by hand, recording each call. */
function makeCache(options?: {
  shouldCache?: (value: string | undefined) => boolean;
}) {
  const calls: Array<{ key: string; fresh: boolean }> = [];
  const pending: Array<Deferred<Computed<string, string | undefined>>> = [];
  const invalidated: string[] = [];
  const cache = new DerivedCache<string, string | undefined>({
    topic: "test",
    compute: (key, { fresh }) => {
      calls.push({ key, fresh });
      const d = deferred<Computed<string, string | undefined>>();
      pending.push(d);
      return d.promise;
    },
    onInvalidate: (key) => invalidated.push(key),
    ...options,
  });
  return { cache, calls, pending, invalidated };
}

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

describe("DerivedCache", () => {
  it("serves a settled key from cache, a negative result included", async () => {
    const { cache, calls, pending } = makeCache();
    const first = cache.get("A");
    pending[0]?.resolve({ value: undefined });
    expect(await first).toBeUndefined();

    expect(await cache.get("A")).toBeUndefined();
    expect(calls).toHaveLength(1);
  });

  it("shares one compute between concurrent callers of a key", async () => {
    const { cache, calls, pending } = makeCache();
    const a = cache.get("A");
    const b = cache.get("A");
    pending[0]?.resolve({ value: "svg" });

    expect(await a).toBe("svg");
    expect(await b).toBe("svg");
    expect(calls).toHaveLength(1);
  });

  it("does not let a compute in flight at invalidation write its value, and does not let a later caller join it", async () => {
    const { cache, calls, pending } = makeCache();
    const stale = cache.get("A");
    cache.invalidate("A");
    const replacement = cache.get("A");
    pending[0]?.resolve({ value: "old" });
    pending[1]?.resolve({ value: "new" });

    expect(await stale).toBe("old");
    expect(await replacement).toBe("new");
    expect(calls).toHaveLength(2);
    expect(await cache.get("A")).toBe("new");
    expect(calls).toHaveLength(2);
  });

  it("disowns computes in flight on clear", async () => {
    const { cache, calls, pending } = makeCache();
    const stale = cache.get("A");
    expect(cache.clear()).toBe(0);
    pending[0]?.resolve({ value: "old" });
    await stale;

    const again = cache.get("A");
    pending[1]?.resolve({ value: "new" });
    expect(await again).toBe("new");
    expect(calls).toHaveLength(2);
  });

  it("reports how many values clear dropped", async () => {
    const { cache, pending } = makeCache();
    const a = cache.get("A");
    const b = cache.get("B");
    pending[0]?.resolve({ value: "a" });
    pending[1]?.resolve({ value: "b" });
    await Promise.all([a, b]);

    expect(cache.clear()).toBe(2);
  });

  it("asks for a fresh compute once after an invalidation, and not for a join or a hit", async () => {
    const { cache, calls, pending } = makeCache();
    cache.invalidate("A");
    const first = cache.get("A");
    const joined = cache.get("A");
    pending[0]?.resolve({ value: "x" });
    await Promise.all([first, joined]);
    await cache.get("A");

    expect(calls).toEqual([{ key: "A", fresh: true }]);

    const next = cache.get("B");
    pending[1]?.resolve({ value: "y" });
    await next;
    expect(calls[1]).toEqual({ key: "B", fresh: false });
  });

  it("keeps the fresh mark across clear", async () => {
    const { cache, calls, pending } = makeCache();
    cache.invalidate("A");
    cache.clear();
    const again = cache.get("A");
    pending[0]?.resolve({ value: "x" });
    await again;

    expect(calls).toEqual([{ key: "A", fresh: true }]);
  });

  it("re-arms the fresh mark for the replacement of a render disowned by an invalidation", async () => {
    const { cache, calls, pending } = makeCache();
    cache.invalidate("A");
    const first = cache.get("A");
    cache.invalidate("A");
    const replacement = cache.get("A");
    pending[0]?.resolve({ value: "old" });
    pending[1]?.resolve({ value: "new" });
    await Promise.all([first, replacement]);

    expect(calls.map((c) => c.fresh)).toEqual([true, true]);
  });

  it("cascades an invalidation to the entries derived from the key", async () => {
    const { cache, pending, invalidated } = makeCache();
    const sub = cache.get("Sub");
    pending[0]?.resolve({ value: "svg", dependsOn: ["Base"] });
    await sub;

    cache.invalidate("Base");

    expect(invalidated).toEqual(["Base", "Sub"]);
  });

  it("reaches an entry through a transitively listed ancestor", async () => {
    const { cache, pending, invalidated } = makeCache();
    const sub = cache.get("Sub");
    pending[0]?.resolve({ value: "svg", dependsOn: ["Mid", "Base"] });
    await sub;

    cache.invalidate("Base");

    expect(invalidated).toEqual(["Base", "Sub"]);
  });

  it("leaves an unrelated entry cached when another key is invalidated", async () => {
    const { cache, calls, pending } = makeCache();
    const sub = cache.get("Sub");
    pending[0]?.resolve({ value: "svg", dependsOn: ["Base"] });
    await sub;

    cache.invalidate("Other");

    expect(await cache.get("Sub")).toBe("svg");
    expect(calls).toHaveLength(1);
  });

  it("prunes the edge to a base the key no longer depends on", async () => {
    const { cache, pending, invalidated } = makeCache();
    const first = cache.get("Sub");
    pending[0]?.resolve({ value: "svg", dependsOn: ["OldBase"] });
    await first;
    cache.invalidate("Sub");
    const second = cache.get("Sub");
    pending[1]?.resolve({ value: "svg", dependsOn: ["NewBase"] });
    await second;
    invalidated.length = 0;

    cache.invalidate("OldBase");
    expect(invalidated).toEqual(["OldBase"]);

    invalidated.length = 0;
    cache.invalidate("NewBase");
    expect(invalidated).toEqual(["NewBase", "Sub"]);
  });

  it("keeps the last good edges when a compute reports its chain as unknown", async () => {
    const { cache, pending, invalidated } = makeCache();
    const first = cache.get("Sub");
    pending[0]?.resolve({ value: "svg", dependsOn: ["Base"] });
    await first;
    cache.invalidate("Sub");
    const failed = cache.get("Sub");
    pending[1]?.resolve({ value: undefined });
    await failed;
    invalidated.length = 0;

    cache.invalidate("Base");

    expect(invalidated).toEqual(["Base", "Sub"]);
  });

  it("drops a value whose base was invalidated while it was computing", async () => {
    const { cache, calls, pending, invalidated } = makeCache();
    const sub = cache.get("Sub");
    cache.invalidate("Base");
    invalidated.length = 0;
    pending[0]?.resolve({ value: "stale", dependsOn: ["Base"] });
    await sub;

    expect(invalidated).toEqual(["Sub"]);
    const again = cache.get("Sub");
    pending[1]?.resolve({ value: "fresh", dependsOn: ["Base"] });
    expect(await again).toBe("fresh");
    expect(calls).toHaveLength(2);
  });

  it("does not re-invalidate a value whose base was invalidated before it started", async () => {
    const { cache, pending, invalidated } = makeCache();
    cache.invalidate("Base");
    invalidated.length = 0;
    const sub = cache.get("Sub");
    pending[0]?.resolve({ value: "svg", dependsOn: ["Base"] });
    await sub;

    expect(invalidated).toEqual([]);
  });

  it("does not cache a value shouldCache refuses, so the next read retries", async () => {
    const { cache, calls, pending } = makeCache({
      shouldCache: (value) => value !== undefined,
    });
    const miss = cache.get("A");
    pending[0]?.resolve({ value: undefined });
    await miss;

    const retry = cache.get("A");
    pending[1]?.resolve({ value: "def" });
    expect(await retry).toBe("def");
    expect(calls).toHaveLength(2);
    expect(await cache.get("A")).toBe("def");
    expect(calls).toHaveLength(2);
  });

  it("does not cache or record edges for a rejected compute, and lets the next read retry", async () => {
    const compute = vi
      .fn<(key: string) => Promise<Computed<string, string>>>()
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce({ value: "ok" });
    const cache = new DerivedCache<string, string>({
      topic: "test",
      compute,
    });

    await expect(cache.get("A")).rejects.toThrow("boom");
    await flush();
    expect(await cache.get("A")).toBe("ok");
    expect(compute).toHaveBeenCalledTimes(2);
  });
});
