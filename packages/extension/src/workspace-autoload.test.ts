import * as fsp from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ClassInvalidationRegistry } from "./invalidation.js";
import {
  autoLoadWorkspace,
  loadEntryFilesAndRefresh,
  registerWorkspaceAutoload,
  type AutoLoadClient,
  type WorkspaceAutoloadDeps,
} from "./workspace-autoload.js";

/** Every entry file parses as a single entity unless a test says otherwise. */
const singleEntity = (): AutoLoadClient["parseFile"] =>
  vi.fn(async () => ({ classNames: ["M"] }));

/** Client whose loadFile returns `results[i]` for the i-th call. */
function client(results: boolean[]): AutoLoadClient {
  let i = 0;
  return {
    parseFile: singleEntity(),
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
      parseFile: singleEntity(),
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

  it("resolves a two-deep within chain by looping until no pass makes progress", async () => {
    const refresh = vi.fn();
    // `grandchild` needs `child`, which needs `parent`. Discovery lists them
    // parent-last, so it takes three passes: parent (pass 1), child (pass 2),
    // grandchild (pass 3).
    const perFile = new Map<string, boolean[]>([
      ["grandchild.mo", [false, false, true]],
      ["child.mo", [false, true]],
      ["parent.mo", [true]],
    ]);
    const idx = new Map<string, number>();
    const c: AutoLoadClient = {
      parseFile: singleEntity(),
      loadFile: vi.fn(async ({ fileName }: { fileName: string }) => {
        const i = idx.get(fileName) ?? 0;
        idx.set(fileName, i + 1);
        return { success: perFile.get(fileName)?.[i] ?? false };
      }),
      getErrorString: vi.fn(async () => ({
        errorString: "Failed to insert class within its parent;",
      })),
    };

    await loadEntryFilesAndRefresh(
      c,
      ["grandchild.mo", "child.mo", "parent.mo"],
      refresh,
    );

    const grandchildCalls = (
      c.loadFile as ReturnType<typeof vi.fn>
    ).mock.calls.filter(
      (args) => (args[0] as { fileName: string }).fileName === "grandchild.mo",
    );
    expect(grandchildCalls).toHaveLength(3); // loaded only on the third pass
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("never loads an entry file declaring several top-level classes (#452)", async () => {
    const refresh = vi.fn();
    const c = client([true]);
    c.parseFile = vi.fn(async ({ fileName }: { fileName: string }) => ({
      classNames: fileName === "AB.mo" ? ["A", "B"] : ["M"],
    }));

    const skipped = await loadEntryFilesAndRefresh(
      c,
      ["AB.mo", "M.mo"],
      refresh,
    );

    expect(skipped).toEqual([{ fileName: "AB.mo", classNames: ["A", "B"] }]);
    expect(c.loadFile).toHaveBeenCalledTimes(1);
    expect(c.loadFile).toHaveBeenCalledWith({ fileName: "M.mo" });
  });

  it("keeps a refused file out of the retry loop as well", async () => {
    const refresh = vi.fn();
    // `M.mo` fails its first pass and succeeds on the retry, which `P.mo`'s
    // first-pass success is what enables — so the loop runs a second pass,
    // which must not reconsider `AB.mo`.
    const perFile = new Map<string, boolean[]>([
      ["M.mo", [false, true]],
      ["P.mo", [true]],
    ]);
    const idx = new Map<string, number>();
    const names: string[] = [];
    const c: AutoLoadClient = {
      parseFile: vi.fn(async ({ fileName }: { fileName: string }) => ({
        classNames: fileName === "AB.mo" ? ["A", "B"] : ["M"],
      })),
      loadFile: vi.fn(async ({ fileName }: { fileName: string }) => {
        names.push(fileName);
        const i = idx.get(fileName) ?? 0;
        idx.set(fileName, i + 1);
        return { success: perFile.get(fileName)?.[i] ?? false };
      }),
      getErrorString: vi.fn(async () => ({ errorString: "boom" })),
    };

    await loadEntryFilesAndRefresh(c, ["AB.mo", "M.mo", "P.mo"], refresh);

    expect(names).toEqual(["M.mo", "P.mo", "M.mo"]);
  });

  it("refreshes once even if a load throws, as long as one succeeds", async () => {
    const refresh = vi.fn();
    const c: AutoLoadClient = {
      parseFile: singleEntity(),
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

describe("autoLoadWorkspace / registerWorkspaceAutoload", () => {
  let tmp: string;
  let entryFile: string;

  beforeEach(async () => {
    tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "ws-autoload-"));
    entryFile = path.join(tmp, "Foo.mo");
    await fsp.writeFile(entryFile, "model Foo\nend Foo;\n");
  });

  afterEach(async () => {
    await fsp.rm(tmp, { recursive: true, force: true });
  });

  describe("autoLoadWorkspace", () => {
    it("discovers and loads the workspace's entry files, then refreshes once", async () => {
      const refresh = vi.fn();
      const onSkipped = vi.fn();
      const c = client([true]);

      await autoLoadWorkspace({
        folders: () => [tmp],
        ensureClient: async () => c,
        refresh,
        onSkipped,
      });

      expect(c.loadFile).toHaveBeenCalledWith({ fileName: entryFile });
      expect(refresh).toHaveBeenCalledTimes(1);
      expect(onSkipped).not.toHaveBeenCalled();
    });

    it("does nothing when there are no workspace folders", async () => {
      const ensureClient = vi.fn();

      await autoLoadWorkspace({
        folders: () => [],
        ensureClient,
        refresh: vi.fn(),
        onSkipped: vi.fn(),
      });

      expect(ensureClient).not.toHaveBeenCalled();
    });

    it("does not reject when deps.folders() throws (#483)", async () => {
      const ensureClient = vi.fn();

      await expect(
        autoLoadWorkspace({
          folders: () => {
            throw new Error("workspaceFolders unavailable");
          },
          ensureClient,
          refresh: vi.fn(),
          onSkipped: vi.fn(),
        }),
      ).resolves.toBeUndefined();
      expect(ensureClient).not.toHaveBeenCalled();
    });

    it("does not reject when a thrown value isn't an Error (#483)", async () => {
      const ensureClient = vi.fn();

      await expect(
        autoLoadWorkspace({
          folders: () => {
            throw "workspaceFolders unavailable";
          },
          ensureClient,
          refresh: vi.fn(),
          onSkipped: vi.fn(),
        }),
      ).resolves.toBeUndefined();
      expect(ensureClient).not.toHaveBeenCalled();
    });
  });

  describe("registerWorkspaceAutoload", () => {
    it("re-runs the workspace autoload when the session is replaced (#466)", async () => {
      const refresh = vi.fn();
      const c = client([true]);
      const invalidation = new ClassInvalidationRegistry();
      const deps: WorkspaceAutoloadDeps = {
        folders: () => [tmp],
        ensureClient: async () => c,
        refresh,
        onSkipped: vi.fn(),
      };

      registerWorkspaceAutoload(invalidation, deps);
      expect(c.loadFile).not.toHaveBeenCalled();

      invalidation.sessionReplaced();

      await vi.waitFor(() => expect(c.loadFile).toHaveBeenCalledTimes(1));
      expect(c.loadFile).toHaveBeenCalledWith({ fileName: entryFile });
      expect(refresh).toHaveBeenCalledTimes(1);
    });

    it("stops re-running the autoload once the returned handle is disposed", async () => {
      const c = client([true]);
      const invalidation = new ClassInvalidationRegistry();
      const deps: WorkspaceAutoloadDeps = {
        folders: () => [tmp],
        ensureClient: async () => c,
        refresh: vi.fn(),
        onSkipped: vi.fn(),
      };

      registerWorkspaceAutoload(invalidation, deps).dispose();
      invalidation.sessionReplaced();
      await new Promise((r) => setTimeout(r, 0));

      expect(c.loadFile).not.toHaveBeenCalled();
    });

    it("serializes back-to-back resets instead of racing overlapping sweeps (#483)", async () => {
      const invalidation = new ClassInvalidationRegistry();

      // The 2nd reset's `ensureClient()` call is blocked so the test can fire
      // a second `:reset` while the first sweep is still mid-flight, the way
      // a user firing `:reset` twice in quick succession would.
      let releaseFirstSweep: (() => void) | undefined;
      let ensureCalls = 0;
      const c = client([true, true]);
      const deps: WorkspaceAutoloadDeps = {
        folders: () => [tmp],
        ensureClient: async () => {
          ensureCalls++;
          if (ensureCalls === 1) {
            await new Promise<void>((resolve) => {
              releaseFirstSweep = resolve;
            });
          }
          return c;
        },
        refresh: vi.fn(),
        onSkipped: vi.fn(),
      };

      registerWorkspaceAutoload(invalidation, deps);

      invalidation.sessionReplaced(); // 1st `:reset`
      await vi.waitFor(() => expect(ensureCalls).toBe(1));

      invalidation.sessionReplaced(); // 2nd `:reset`, fired before the 1st sweep settles
      // Real disk I/O (`discoverEntryPoints`), not just microtasks — give an
      // unserialized 2nd sweep enough real time to reach `ensureClient()` if
      // nothing is chaining it behind the 1st.
      await new Promise((r) => setTimeout(r, 100));

      // The 2nd sweep must wait for the 1st instead of starting a second,
      // overlapping `loadFile` pass against the same entry file.
      expect(c.loadFile).not.toHaveBeenCalled();
      expect(ensureCalls).toBe(1);

      releaseFirstSweep?.();
      // Both sweeps now run in sequence, chained behind one another.
      await vi.waitFor(() => expect(c.loadFile).toHaveBeenCalledTimes(2));
      expect(ensureCalls).toBe(2);
    });

    it("serializes the activation-time run() against an overlapping :reset (#483)", async () => {
      const invalidation = new ClassInvalidationRegistry();

      // The activation sweep's `ensureClient()` is blocked so the test can
      // fire a `:reset` while it's still mid-flight, the way a user resetting
      // during startup would.
      let releaseActivationSweep: (() => void) | undefined;
      let ensureCalls = 0;
      const c = client([true, true]);
      const deps: WorkspaceAutoloadDeps = {
        folders: () => [tmp],
        ensureClient: async () => {
          ensureCalls++;
          if (ensureCalls === 1) {
            await new Promise<void>((resolve) => {
              releaseActivationSweep = resolve;
            });
          }
          return c;
        },
        refresh: vi.fn(),
        onSkipped: vi.fn(),
      };

      const autoload = registerWorkspaceAutoload(invalidation, deps);

      autoload.run(); // the activation-time sweep
      await vi.waitFor(() => expect(ensureCalls).toBe(1));

      invalidation.sessionReplaced(); // `:reset` landing mid-activation-sweep
      // Real disk I/O (`discoverEntryPoints`), not just microtasks — give an
      // unserialized reset sweep enough real time to reach `ensureClient()`
      // if it isn't chained behind the activation sweep.
      await new Promise((r) => setTimeout(r, 100));

      // The reset sweep must wait for the activation sweep instead of
      // starting a second, overlapping `loadFile` pass against the client
      // `reset()` would otherwise have already closed.
      expect(c.loadFile).not.toHaveBeenCalled();
      expect(ensureCalls).toBe(1);

      releaseActivationSweep?.();
      // Both sweeps now run in sequence, chained behind one another.
      await vi.waitFor(() => expect(c.loadFile).toHaveBeenCalledTimes(2));
      expect(ensureCalls).toBe(2);
    });

    it("derives entry points from scanMoFiles on :reset instead of walking disk again (#484)", async () => {
      const refresh = vi.fn();
      const c = client([true]);
      const invalidation = new ClassInvalidationRegistry();
      const scanMoFiles = vi.fn(async () => [entryFile]);
      const deps: WorkspaceAutoloadDeps = {
        folders: () => [tmp],
        ensureClient: async () => c,
        refresh,
        onSkipped: vi.fn(),
        scanMoFiles,
      };

      registerWorkspaceAutoload(invalidation, deps);
      invalidation.sessionReplaced();

      await vi.waitFor(() => expect(c.loadFile).toHaveBeenCalledTimes(1));
      expect(c.loadFile).toHaveBeenCalledWith({ fileName: entryFile });
      expect(scanMoFiles).toHaveBeenCalledTimes(1);
    });

    it("falls back to discoverEntryPoints on :reset when scanMoFiles is absent", async () => {
      const refresh = vi.fn();
      const c = client([true]);
      const invalidation = new ClassInvalidationRegistry();
      const deps: WorkspaceAutoloadDeps = {
        folders: () => [tmp],
        ensureClient: async () => c,
        refresh,
        onSkipped: vi.fn(),
      };

      registerWorkspaceAutoload(invalidation, deps);
      invalidation.sessionReplaced();

      await vi.waitFor(() => expect(c.loadFile).toHaveBeenCalledTimes(1));
      expect(c.loadFile).toHaveBeenCalledWith({ fileName: entryFile });
    });
  });
});
