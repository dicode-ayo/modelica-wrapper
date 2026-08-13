import { describe, expect, it, vi } from "vitest";

import { createOmcClientCache } from "./omc-client-cache.js";

const noopClose = async (): Promise<void> => {};

interface Deferred {
  resolve: (c: object) => void;
  reject: (e: unknown) => void;
}

/** A `spawn` whose every result is resolved by the test, in order. */
function deferredSpawns(): {
  spawn: () => Promise<object>;
  pending: Deferred[];
} {
  const pending: Deferred[] = [];
  const spawn = vi.fn(
    () =>
      new Promise<object>((resolve, reject) => {
        pending.push({ resolve, reject });
      }),
  );
  return { spawn, pending };
}

function nth<T>(arr: T[], i: number): T {
  const v = arr[i];
  if (v === undefined) throw new Error(`no pending spawn ${i}`);
  return v;
}

/** Let queued microtasks (a `reset()`'s close→ensure chain) settle. */
async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe("createOmcClientCache", () => {
  it("spawns once for concurrent ensure() callers racing before the first resolves", async () => {
    let resolveSpawn: (c: object) => void = () => {};
    const spawn = vi.fn(
      () =>
        new Promise<object>((r) => {
          resolveSpawn = r;
        }),
    );
    const cache = createOmcClientCache(spawn, noopClose);

    // Five racing first-callers, mirroring activation (autoload, tree mount,
    // watcher seed, restored tab).
    const pending = [
      cache.ensure(),
      cache.ensure(),
      cache.ensure(),
      cache.ensure(),
      cache.ensure(),
    ];
    const client = {};
    resolveSpawn(client);
    const results = await Promise.all(pending);

    expect(spawn).toHaveBeenCalledTimes(1);
    expect(results.every((r) => r === client)).toBe(true);
  });

  it("returns the cached client without respawning", async () => {
    const client = {};
    const spawn = vi.fn(() => Promise.resolve(client));
    const cache = createOmcClientCache(spawn, noopClose);

    expect(await cache.ensure()).toBe(client);
    expect(await cache.ensure()).toBe(client);
    expect(spawn).toHaveBeenCalledTimes(1);
  });

  it("respawns after a failed spawn", async () => {
    const spawn = vi
      .fn()
      .mockRejectedValueOnce(new Error("OMC down"))
      .mockResolvedValueOnce({});
    const cache = createOmcClientCache(spawn, noopClose);

    await expect(cache.ensure()).rejects.toThrow("OMC down");
    await cache.ensure();

    expect(spawn).toHaveBeenCalledTimes(2);
  });

  it("closes the old client and respawns on reset", async () => {
    const a = { id: "a" };
    const b = { id: "b" };
    const spawn = vi
      .fn<() => Promise<object>>()
      .mockResolvedValueOnce(a)
      .mockResolvedValueOnce(b);
    const closed: object[] = [];
    const cache = createOmcClientCache(spawn, async (c) => {
      closed.push(c);
    });

    expect(await cache.ensure()).toBe(a);
    expect(await cache.reset()).toBe(b);
    expect(closed).toEqual([a]);
    expect(spawn).toHaveBeenCalledTimes(2);
  });

  it("reaps the abandoned client when close() races an in-flight spawn", async () => {
    const { spawn, pending } = deferredSpawns();
    const closed: object[] = [];
    const cache = createOmcClientCache(spawn, async (c) => {
      closed.push(c);
    });

    const first = cache.ensure(); // spawn in flight, client still undefined
    await cache.close(); // clears the slot; nothing to close yet
    const c = { id: "a" };
    nth(pending, 0).resolve(c); // resolves after close → orphaned

    // The abandoned continuation reaps the process, then rejects its waiter.
    await expect(first).rejects.toThrow(/closed during spawn/);
    expect(closed).toEqual([c]);
  });

  it("reaps the loser when reset() races an in-flight spawn", async () => {
    const { spawn, pending } = deferredSpawns();
    const closed: object[] = [];
    const cache = createOmcClientCache(spawn, async (obj) => {
      closed.push(obj);
    });

    const first = cache.ensure(); // spawn A
    const resetP = cache.reset(); // close() clears the slot, then spawn B
    await flush();

    const a = { id: "a" };
    const b = { id: "b" };
    nth(pending, 1).resolve(b); // B wins the slot
    nth(pending, 0).resolve(a); // A resolves late → orphaned + reaped

    await expect(first).rejects.toThrow(/closed during spawn/);
    expect(await resetP).toBe(b);
    expect(closed).toEqual([a]);
    // Cache serves B without a third spawn.
    expect(await cache.ensure()).toBe(b);
    expect(spawn).toHaveBeenCalledTimes(2);
  });

  it("a stale reject doesn't clobber a newer in-flight spawn", async () => {
    const { spawn, pending } = deferredSpawns();
    const cache = createOmcClientCache(spawn, noopClose);

    const first = cache.ensure(); // spawn A
    const resetP = cache.reset(); // close() + spawn B
    await flush();

    nth(pending, 0).reject(new Error("A failed")); // old spawn fails
    await expect(first).rejects.toThrow("A failed");

    // B still owns the slot — a further caller must not trigger a third spawn.
    const third = cache.ensure();
    expect(spawn).toHaveBeenCalledTimes(2);

    const b = { id: "b" };
    nth(pending, 1).resolve(b);
    expect(await resetP).toBe(b);
    expect(await third).toBe(b);
  });
});
