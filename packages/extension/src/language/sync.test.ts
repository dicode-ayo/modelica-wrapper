/**
 * Unit tests for the buffer ↔ OMC load policy. The OMC `loadFile` wrapper is a
 * plain mock — no live OMC.
 */

import { describe, expect, it, vi } from "vitest";

import { OmcSync, type SyncClient } from "./sync.js";

/** A `loadFile` mock that resolves `success` and records its calls. */
function clientOk(success = true): SyncClient & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    loadFile: vi.fn(({ fileName }) => {
      calls.push(fileName);
      return Promise.resolve({ success });
    }),
  };
}

describe("OmcSync — load on first touch", () => {
  it("loads the file once and is a no-op on subsequent touches", async () => {
    const client = clientOk();
    const sync = new OmcSync(client);

    expect(await sync.ensureLoaded("/a/Foo.mo")).toBe(true);
    expect(await sync.ensureLoaded("/a/Foo.mo")).toBe(true);
    expect(await sync.ensureLoaded("/a/Foo.mo")).toBe(true);

    expect(client.calls).toEqual(["/a/Foo.mo"]);
    expect(sync.isLoaded("/a/Foo.mo")).toBe(true);
  });

  it("de-dupes concurrent first-touch loads of the same file", async () => {
    const client = clientOk();
    const sync = new OmcSync(client);

    const [a, b] = await Promise.all([
      sync.ensureLoaded("/a/Foo.mo"),
      sync.ensureLoaded("/a/Foo.mo"),
    ]);

    expect(a).toBe(true);
    expect(b).toBe(true);
    // Both awaited the same in-flight load → loadFile called exactly once.
    expect(client.loadFile).toHaveBeenCalledTimes(1);
  });
});

describe("OmcSync — re-load on save", () => {
  it("re-loads after markSaved", async () => {
    const client = clientOk();
    const sync = new OmcSync(client);

    await sync.ensureLoaded("/a/Foo.mo");
    sync.markSaved("/a/Foo.mo");
    expect(sync.isLoaded("/a/Foo.mo")).toBe(false);
    await sync.ensureLoaded("/a/Foo.mo");

    expect(client.calls).toEqual(["/a/Foo.mo", "/a/Foo.mo"]);
  });

  it("invalidate clears the loaded flag", async () => {
    const client = clientOk();
    const sync = new OmcSync(client);

    await sync.ensureLoaded("/a/Foo.mo");
    sync.invalidate("/a/Foo.mo");
    expect(sync.isLoaded("/a/Foo.mo")).toBe(false);
    await sync.ensureLoaded("/a/Foo.mo");
    expect(client.loadFile).toHaveBeenCalledTimes(2);
  });
});

describe("OmcSync — failure handling", () => {
  it("leaves the file unloaded when loadFile reports failure (retries next touch)", async () => {
    const client = clientOk(false);
    const sync = new OmcSync(client);

    expect(await sync.ensureLoaded("/a/Foo.mo")).toBe(false);
    expect(sync.isLoaded("/a/Foo.mo")).toBe(false);
    // Next touch retries.
    await sync.ensureLoaded("/a/Foo.mo");
    expect(client.loadFile).toHaveBeenCalledTimes(2);
  });

  it("does not throw when loadFile rejects; returns false and retries", async () => {
    const client: SyncClient = {
      loadFile: vi
        .fn()
        .mockRejectedValueOnce(new Error("omc down"))
        .mockResolvedValueOnce({ success: true }),
    };
    const sync = new OmcSync(client);

    expect(await sync.ensureLoaded("/a/Foo.mo")).toBe(false);
    expect(await sync.ensureLoaded("/a/Foo.mo")).toBe(true);
    expect(sync.isLoaded("/a/Foo.mo")).toBe(true);
  });
});

describe("OmcSync — generation guard against save-during-load races", () => {
  it("discards a load whose generation snapshot was invalidated by markSaved", async () => {
    // A `loadFile` that resolves only when we tell it to, so we can interleave a
    // `markSaved` in the middle of the in-flight load.
    let resolveLoad: (value: { success: boolean }) => void = () => {};
    const loadFile = vi.fn(
      () =>
        new Promise<{ success: boolean }>((res) => {
          resolveLoad = res;
        }),
    );
    const sync = new OmcSync({ loadFile });

    const inFlight = sync.ensureLoaded("/a/Foo.mo");
    // Save fires while the first-touch load is still pending → generation bumps.
    sync.markSaved("/a/Foo.mo");
    // The load now completes with success=true against pre-save text.
    resolveLoad({ success: true });
    expect(await inFlight).toBe(false);
    // Critical: the file must NOT be considered loaded, so the next touch
    // re-issues a fresh `loadFile`.
    expect(sync.isLoaded("/a/Foo.mo")).toBe(false);
  });

  it("invalidate() also bumps the generation (same shape as markSaved)", async () => {
    let resolveLoad: (value: { success: boolean }) => void = () => {};
    const loadFile = vi.fn(
      () =>
        new Promise<{ success: boolean }>((res) => {
          resolveLoad = res;
        }),
    );
    const sync = new OmcSync({ loadFile });

    const inFlight = sync.ensureLoaded("/a/Foo.mo");
    sync.invalidate("/a/Foo.mo");
    resolveLoad({ success: true });
    expect(await inFlight).toBe(false);
    expect(sync.isLoaded("/a/Foo.mo")).toBe(false);
  });
});
