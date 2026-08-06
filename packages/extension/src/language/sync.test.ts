import { describe, expect, it, vi } from "vitest";

import { defaultNormalizeKey, OmcSync, type SyncClient } from "./sync.js";

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
    expect(client.loadFile).toHaveBeenCalledTimes(1);
  });
});

describe("OmcSync — invalidate (re-load on save / forget on close)", () => {
  it("clears the loaded flag and re-loads on the next touch", async () => {
    const client = clientOk();
    const sync = new OmcSync(client);

    await sync.ensureLoaded("/a/Foo.mo");
    sync.invalidate("/a/Foo.mo");
    expect(sync.isLoaded("/a/Foo.mo")).toBe(false);
    await sync.ensureLoaded("/a/Foo.mo");

    expect(client.calls).toEqual(["/a/Foo.mo", "/a/Foo.mo"]);
    expect(client.loadFile).toHaveBeenCalledTimes(2);
  });

  it("invalidateAll re-loads every path on its next touch", async () => {
    const client = clientOk();
    const sync = new OmcSync(client);

    await sync.ensureLoaded("/a/Foo.mo");
    await sync.ensureLoaded("/a/Bar.mo");
    sync.invalidateAll();

    expect(sync.isLoaded("/a/Foo.mo")).toBe(false);
    expect(sync.isLoaded("/a/Bar.mo")).toBe(false);
    await sync.ensureLoaded("/a/Foo.mo");
    await sync.ensureLoaded("/a/Bar.mo");
    expect(client.loadFile).toHaveBeenCalledTimes(4);
  });

  it("invalidateAll discards a load still in flight", async () => {
    let release!: (value: { success: boolean }) => void;
    const client: SyncClient = {
      loadFile: vi.fn(
        () => new Promise<{ success: boolean }>((r) => (release = r)),
      ),
    };
    const sync = new OmcSync(client);

    const pending = sync.ensureLoaded("/a/Foo.mo");
    sync.invalidateAll();
    release({ success: true });

    expect(await pending).toBe(false);
    expect(sync.isLoaded("/a/Foo.mo")).toBe(false);
  });
});

describe("OmcSync — failure handling", () => {
  it("leaves the file unloaded when loadFile reports failure (retries next touch)", async () => {
    const client = clientOk(false);
    const sync = new OmcSync(client);

    expect(await sync.ensureLoaded("/a/Foo.mo")).toBe(false);
    expect(sync.isLoaded("/a/Foo.mo")).toBe(false);
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
  it("discards an in-flight load whose generation snapshot was invalidated", async () => {
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

  it("a touch arriving after invalidate starts a fresh load instead of awaiting the stale in-flight", async () => {
    const pending: Array<(v: { success: boolean }) => void> = [];
    const loadFile = vi.fn(
      () =>
        new Promise<{ success: boolean }>((res) => {
          pending.push(res);
        }),
    );
    const sync = new OmcSync({ loadFile });

    const firstTouch = sync.ensureLoaded("/a/Foo.mo");
    sync.invalidate("/a/Foo.mo");
    const secondTouch = sync.ensureLoaded("/a/Foo.mo");

    expect(loadFile).toHaveBeenCalledTimes(2);
    // Resolve in reverse so the second isn't shadowed by the first.
    pending[1]?.({ success: true });
    pending[0]?.({ success: true });
    expect(await firstTouch).toBe(false); // pre-invalidate snapshot, discarded
    expect(await secondTouch).toBe(true);
    expect(sync.isLoaded("/a/Foo.mo")).toBe(true);
  });
});

describe("OmcSync — normalizeKey", () => {
  it("treats two path casings as the same file when a normalizer is supplied", async () => {
    const client = clientOk();
    const sync = new OmcSync(client, { normalizeKey: (p) => p.toLowerCase() });

    await sync.ensureLoaded("C:\\Work\\Foo.mo");
    expect(sync.isLoaded("c:\\work\\foo.mo")).toBe(true);
    sync.invalidate("c:\\work\\foo.mo");
    expect(sync.isLoaded("C:\\Work\\Foo.mo")).toBe(false);
    await sync.ensureLoaded("C:\\Work\\Foo.mo");
    expect(client.loadFile).toHaveBeenCalledTimes(2);
  });

  it("an explicit identity normalizer keeps casings distinct", async () => {
    const client = clientOk();
    const sync = new OmcSync(client, { normalizeKey: (p) => p });

    await sync.ensureLoaded("C:\\Work\\Foo.mo");
    expect(sync.isLoaded("c:\\work\\foo.mo")).toBe(false);
  });
});

describe("defaultNormalizeKey", () => {
  it("matches the host filesystem's case-sensitivity", () => {
    const caseInsensitive =
      process.platform === "win32" || process.platform === "darwin";
    expect(defaultNormalizeKey("C:\\Work\\Foo.mo")).toBe(
      caseInsensitive ? "c:\\work\\foo.mo" : "C:\\Work\\Foo.mo",
    );
  });
});
