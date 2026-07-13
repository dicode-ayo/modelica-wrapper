import { describe, expect, it, vi } from "vitest";

import {
  loadEntryFilesAndRefresh,
  type AutoLoadClient,
} from "./workspace-autoload.js";

/** Client whose loadFile returns `results[i]` for the i-th call. */
function client(results: boolean[]): AutoLoadClient {
  let i = 0;
  return {
    loadFile: vi.fn(async () => ({ success: results[i++] ?? false })),
    getErrorString: vi.fn(async () => ({ errorString: "boom" })),
  };
}

describe("loadEntryFilesAndRefresh", () => {
  it("refreshes exactly once, after every file has loaded", async () => {
    const refresh = vi.fn();
    const c = client([true, true]);

    await loadEntryFilesAndRefresh(c, ["A.mo", "B.mo"], refresh);

    expect(c.loadFile).toHaveBeenCalledTimes(2);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("does not refresh for an empty file list (empty workspace keeps its state)", async () => {
    const refresh = vi.fn();
    const c = client([]);

    await loadEntryFilesAndRefresh(c, [], refresh);

    expect(c.loadFile).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("does not refresh when nothing loaded successfully", async () => {
    const refresh = vi.fn();
    const c = client([false, false]);

    await loadEntryFilesAndRefresh(c, ["A.mo", "B.mo"], refresh);

    expect(refresh).not.toHaveBeenCalled();
  });

  it("refreshes once when at least one file loads despite others failing", async () => {
    const refresh = vi.fn();
    const c = client([false, true]);

    await loadEntryFilesAndRefresh(c, ["A.mo", "B.mo"], refresh);

    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("retries a file that failed the first pass once its parent has loaded", async () => {
    const refresh = vi.fn();
    // `child.mo` (a `within Parent;` class) fails on the first pass because
    // `parent.mo` hasn't loaded yet, then succeeds on the retry.
    const perFile = new Map<string, boolean[]>([
      ["child.mo", [false, true]],
      ["parent.mo", [true]],
    ]);
    const idx = new Map<string, number>();
    const c: AutoLoadClient = {
      loadFile: vi.fn(async ({ fileName }: { fileName: string }) => {
        const i = idx.get(fileName) ?? 0;
        idx.set(fileName, i + 1);
        return { success: perFile.get(fileName)?.[i] ?? false };
      }),
      getErrorString: vi.fn(async () => ({
        errorString: "Failed to insert class child within Parent;",
      })),
    };

    await loadEntryFilesAndRefresh(c, ["child.mo", "parent.mo"], refresh);

    const childCalls = (
      c.loadFile as ReturnType<typeof vi.fn>
    ).mock.calls.filter(
      (args) => (args[0] as { fileName: string }).fileName === "child.mo",
    );
    expect(childCalls).toHaveLength(2);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("refreshes once even if a load throws, as long as one succeeds", async () => {
    const refresh = vi.fn();
    const c: AutoLoadClient = {
      loadFile: vi
        .fn()
        .mockRejectedValueOnce(new Error("Socket is busy writing"))
        .mockResolvedValueOnce({ success: true }),
      getErrorString: vi.fn(async () => ({ errorString: "boom" })),
    };

    await loadEntryFilesAndRefresh(c, ["A.mo", "B.mo"], refresh);

    expect(refresh).toHaveBeenCalledTimes(1);
  });
});
