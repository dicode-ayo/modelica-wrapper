import { describe, expect, it, vi } from "vitest";

import { createOmcClientCache } from "./omc-client-cache.js";

const noopClose = async (): Promise<void> => {};

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
    // watcher seed, restored tab). Before the fix each spawned its own OMC.
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
    const spawn = vi.fn().mockResolvedValueOnce(a).mockResolvedValueOnce(b);
    const closed: object[] = [];
    const cache = createOmcClientCache(spawn, async (c) => {
      closed.push(c);
    });

    expect(await cache.ensure()).toBe(a);
    expect(await cache.reset()).toBe(b);
    expect(closed).toEqual([a]);
    expect(spawn).toHaveBeenCalledTimes(2);
  });
});
