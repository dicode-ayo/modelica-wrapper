import { describe, expect, it, vi } from "vitest";

import { defaultNormalizeKey, OmcSync, type SyncClient } from "./sync.js";

/** Every file parses as a single entity unless a test says otherwise. */
function singleEntity(classNames = ["Foo"]) {
  return vi.fn(() => Promise.resolve({ classNames }));
}

function clientOk(success = true): SyncClient & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    parseFile: singleEntity(),
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
      parseFile: singleEntity(),
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

describe("OmcSync — files declaring several top-level classes (#452)", () => {
  function multiEntityClient(): SyncClient {
    return {
      parseFile: vi.fn(() => Promise.resolve({ classNames: ["A", "B"] })),
      loadFile: vi.fn(() => Promise.resolve({ success: true })),
    };
  }

  it("refuses to load one, and reports it", async () => {
    const client = multiEntityClient();
    const onMultiEntity = vi.fn();
    const sync = new OmcSync(client, { onMultiEntity });

    expect(await sync.ensureLoaded("/a/AB.mo")).toBe(false);

    expect(client.loadFile).not.toHaveBeenCalled();
    expect(sync.isLoaded("/a/AB.mo")).toBe(false);
    expect(onMultiEntity).toHaveBeenCalledWith("/a/AB.mo", ["A", "B"]);
  });

  it("reports once however often the file is touched", async () => {
    const client = multiEntityClient();
    const onMultiEntity = vi.fn();
    const sync = new OmcSync(client, { onMultiEntity });

    await sync.ensureLoaded("/a/AB.mo");
    await sync.ensureLoaded("/a/AB.mo");
    await sync.ensureLoaded("/a/AB.mo");

    expect(onMultiEntity).toHaveBeenCalledTimes(1);
    expect(client.parseFile).toHaveBeenCalledTimes(1);
  });

  it("discards a refusal whose parse was invalidated mid-flight", async () => {
    let resolveParse: (v: { classNames: string[] }) => void = () => {};
    const parseFile = vi.fn(
      () =>
        new Promise<{ classNames: string[] }>((res) => {
          resolveParse = res;
        }),
    );
    const loadFile = vi.fn(() => Promise.resolve({ success: true }));
    const onMultiEntity = vi.fn();
    const sync = new OmcSync({ parseFile, loadFile }, { onMultiEntity });

    const inFlight = sync.ensureLoaded("/a/AB.mo");
    await vi.waitFor(() => expect(parseFile).toHaveBeenCalled());
    // A save splits the file while the parse is still out; its answer now
    // describes text that no longer exists.
    sync.invalidate("/a/AB.mo");
    resolveParse({ classNames: ["A", "B"] });
    expect(await inFlight).toBe(false);

    expect(onMultiEntity).not.toHaveBeenCalled();
    parseFile.mockResolvedValue({ classNames: ["A"] });
    expect(await sync.ensureLoaded("/a/AB.mo")).toBe(true);
  });

  it("reconsiders the file after a save splits it", async () => {
    const client = multiEntityClient();
    const sync = new OmcSync(client);
    await sync.ensureLoaded("/a/AB.mo");

    sync.invalidate("/a/AB.mo");
    client.parseFile = vi.fn(() => Promise.resolve({ classNames: ["A"] }));

    expect(await sync.ensureLoaded("/a/AB.mo")).toBe(true);
    expect(client.loadFile).toHaveBeenCalledTimes(1);
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
    const sync = new OmcSync({ parseFile: singleEntity(), loadFile });

    const inFlight = sync.ensureLoaded("/a/Foo.mo");
    // The single-entity pre-flight parse defers `loadFile` past this tick, so
    // `resolveLoad` isn't wired until it has actually been called.
    await vi.waitFor(() => expect(loadFile).toHaveBeenCalled());
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
    const sync = new OmcSync({ parseFile: singleEntity(), loadFile });

    const firstTouch = sync.ensureLoaded("/a/Foo.mo");
    await vi.waitFor(() => expect(loadFile).toHaveBeenCalledTimes(1));
    sync.invalidate("/a/Foo.mo");
    const secondTouch = sync.ensureLoaded("/a/Foo.mo");

    await vi.waitFor(() => expect(loadFile).toHaveBeenCalledTimes(2));
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
