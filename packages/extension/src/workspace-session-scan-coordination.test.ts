/**
 * Regression coverage for #484: pins the contract that sharing one
 * `MoFileScanner` between `registerWorkspaceAutoload` and
 * `registerMoFileWatcher` — each of which reacts to `sessionReplaced` with
 * its own workspace scan — produces exactly one underlying disk scan per
 * `:reset`, not one per listener.
 *
 * This test hands the same scanner instance to both consumers directly; it
 * does not cover extension.ts's own wiring (that the real `moFileScanner` it
 * builds is the one instance passed to both registration calls). That wiring
 * has no automated test — a reviewer reading extension.ts has to confirm it
 * by eye.
 */

import * as fsp from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { resetFileSystemWatchers } from "../test-support/vscode-mock.js";

import { ClassInvalidationRegistry } from "./invalidation.js";
import type { LibraryWebviewProvider } from "./library/library-webview-provider.js";
import { registerMoFileWatcher } from "./mo-file-watcher.js";
import { createSelfWriteGuard } from "./self-write-guard.js";
import type { ModelicaSourceProvider } from "./source-provider.js";
import {
  registerWorkspaceAutoload,
  type WorkspaceAutoloadDeps,
} from "./workspace-autoload.js";
import { createMoFileScanner } from "./workspace-mo-scan.js";

function makeWatcherClient() {
  return {
    parseFile: vi.fn(async () => ({ classNames: ["My.Pkg.Bar"] })),
    loadFile: vi.fn(async () => ({ success: true })),
    deleteClass: vi.fn(async () => ({ success: true })),
  };
}

describe("shared MoFileScanner across sessionReplaced listeners (#484)", () => {
  let tmp: string;
  let entryFile: string;

  beforeEach(async () => {
    resetFileSystemWatchers();
    tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "ws-coord-"));
    entryFile = path.join(tmp, "Foo.mo");
    await fsp.writeFile(entryFile, "model Foo\nend Foo;\n");
  });

  afterEach(async () => {
    await fsp.rm(tmp, { recursive: true, force: true });
  });

  it("runs the underlying disk scan exactly once for one :reset, shared by both listeners", async () => {
    const findFiles = vi.fn(async () => [entryFile]);
    const scanner = createMoFileScanner(findFiles);
    const invalidation = new ClassInvalidationRegistry();

    const watcherClient = makeWatcherClient();
    const moFileWatcher = registerMoFileWatcher({
      ensureClient: async () => watcherClient,
      libraryTree: {
        childrenChanged: vi.fn(),
      } as unknown as LibraryWebviewProvider,
      sourceProvider: {
        notifySourceChanged: vi.fn(),
      } as unknown as ModelicaSourceProvider,
      guard: createSelfWriteGuard(),
      invalidation,
      scanMoFiles: () => scanner.scan(),
    });

    const autoloadClient = {
      parseFile: vi.fn(async () => ({ classNames: ["Foo"] })),
      loadFile: vi.fn(async () => ({ success: true })),
      getErrorString: vi.fn(async () => ({ errorString: "" })),
    };
    const autoloadDeps: WorkspaceAutoloadDeps = {
      folders: () => [tmp],
      ensureClient: async () => autoloadClient,
      refresh: vi.fn(),
      onSkipped: vi.fn(),
      scanMoFiles: () => scanner.scan(),
    };
    const autoload = registerWorkspaceAutoload(invalidation, autoloadDeps);

    // The activation-time mount seed already ran findFiles once — settle it
    // before firing `:reset` so only the reset's own calls are counted below.
    await vi.waitFor(() =>
      expect(watcherClient.parseFile).toHaveBeenCalledTimes(1),
    );
    findFiles.mockClear();

    // Mirrors extension.ts: the scanner is invalidated right before the
    // sessionReplaced fan-out, so `:reset` doesn't serve the activation
    // seed's now-stale memoized scan.
    scanner.invalidate();
    invalidation.sessionReplaced();

    await vi.waitFor(() =>
      expect(autoloadClient.loadFile).toHaveBeenCalledWith({
        fileName: entryFile,
      }),
    );
    await vi.waitFor(() =>
      expect(watcherClient.parseFile).toHaveBeenCalledTimes(2),
    );

    expect(findFiles).toHaveBeenCalledTimes(1);

    moFileWatcher.dispose();
    autoload.dispose();
  });

  it("re-runs the disk scan on a second :reset once the scanner is invalidated between them", async () => {
    const findFiles = vi.fn(async () => [entryFile]);
    const scanner = createMoFileScanner(findFiles);
    const invalidation = new ClassInvalidationRegistry();

    const watcherClient = makeWatcherClient();
    const moFileWatcher = registerMoFileWatcher({
      ensureClient: async () => watcherClient,
      libraryTree: {
        childrenChanged: vi.fn(),
      } as unknown as LibraryWebviewProvider,
      sourceProvider: {
        notifySourceChanged: vi.fn(),
      } as unknown as ModelicaSourceProvider,
      guard: createSelfWriteGuard(),
      invalidation,
      scanMoFiles: () => scanner.scan(),
    });

    await vi.waitFor(() =>
      expect(watcherClient.parseFile).toHaveBeenCalledTimes(1),
    );
    findFiles.mockClear();

    // First `:reset`, coordinated the way extension.ts wires it: invalidate
    // the shared scanner right before the fan-out fires.
    scanner.invalidate();
    invalidation.sessionReplaced();
    await vi.waitFor(() =>
      expect(watcherClient.parseFile).toHaveBeenCalledTimes(2),
    );
    expect(findFiles).toHaveBeenCalledTimes(1);

    // A second `:reset` re-invalidates, so it must hit disk again rather than
    // serving the first reset's memo.
    scanner.invalidate();
    invalidation.sessionReplaced();
    await vi.waitFor(() =>
      expect(watcherClient.parseFile).toHaveBeenCalledTimes(3),
    );
    expect(findFiles).toHaveBeenCalledTimes(2);

    moFileWatcher.dispose();
  });

  it("retries the scan on the next :reset after a failed one, instead of caching the failure", async () => {
    const findFiles: () => Promise<readonly string[]> = vi
      .fn()
      .mockRejectedValueOnce(new Error("glob failed"))
      .mockResolvedValue([entryFile]);
    const scanner = createMoFileScanner(findFiles);
    const invalidation = new ClassInvalidationRegistry();

    const watcherClient = makeWatcherClient();
    const moFileWatcher = registerMoFileWatcher({
      ensureClient: async () => watcherClient,
      libraryTree: {
        childrenChanged: vi.fn(),
      } as unknown as LibraryWebviewProvider,
      sourceProvider: {
        notifySourceChanged: vi.fn(),
      } as unknown as ModelicaSourceProvider,
      guard: createSelfWriteGuard(),
      invalidation,
      scanMoFiles: () => scanner.scan(),
    });

    // The mount seed's own scan() call is the one that fails; seedWorkspaceIndex
    // swallows it (logged, not thrown), so parseFile is never reached.
    await vi.waitFor(() => expect(findFiles).toHaveBeenCalledTimes(1));
    expect(watcherClient.parseFile).not.toHaveBeenCalled();

    scanner.invalidate();
    invalidation.sessionReplaced();

    await vi.waitFor(() =>
      expect(watcherClient.parseFile).toHaveBeenCalledTimes(1),
    );
    expect(findFiles).toHaveBeenCalledTimes(2);

    moFileWatcher.dispose();
  });
});
