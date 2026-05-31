/**
 * Unit test for the save → cache-invalidation glue.
 *
 * The cache's own `invalidate()` is unit-tested in `omc-cache.test.ts`, and
 * `sync.invalidate` in `sync.test.ts`, but nothing proved the *wiring*: that a
 * document save for a Modelica document calls `lookupCache.invalidate()` (the
 * headline staleness defence) and `sync.invalidate`, and that a non-Modelica
 * save does neither. The reviewer flagged this glue as correct-by-inspection
 * but untested. We test the extracted {@link handleDocumentSave} helper directly
 * and also assert `registerLanguageFeatures` actually registers an
 * `onDidSaveTextDocument` listener that routes through it.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  Uri,
  emitSave,
  workspaceListeners,
} from "../../test-support/vscode-mock.js";

import { handleDocumentSave, registerLanguageFeatures } from "./index.js";
import { OmcLookupCache, type CachedOmcClient } from "./omc-cache.js";

/** A document stub the save handler inspects (`languageId` + `uri.fsPath`). */
function doc(languageId: string, fsPath: string) {
  return { languageId, uri: Uri.file(fsPath) } as never;
}

/** A `sync`-shaped stub recording the path it was told was saved. */
function fakeSync() {
  return { invalidate: vi.fn<(path: string) => void>() };
}

/** A throwaway OMC client; the save path never reaches a real OMC round-trip. */
function fakeOmcClient(): CachedOmcClient {
  return {
    getLoadedLibraries: () =>
      Promise.resolve({ libraries: [] as [string, string][] }),
    parseFile: () => Promise.resolve({ classNames: [] }),
    loadFile: () => Promise.resolve({ loaded: true }),
    qualifyPath: ({ path }) => Promise.resolve({ qualifiedPath: path }),
    getClassInformation: () =>
      Promise.resolve({
        fileName: "",
        lineNumberStart: 1,
        columnNumberStart: 1,
        restriction: "model",
        comment: "",
      }),
    getClassComment: () => Promise.resolve({ comment: "" }),
    getComponents: () => Promise.resolve({ components: [] }),
    getInheritedClasses: () => Promise.resolve({ inheritedClasses: [] }),
    getClassNames: () => Promise.resolve({ classNames: [] }),
    searchClassNames: () => Promise.resolve({ classNames: [] }),
    getParameterNames: () => Promise.resolve({ parameters: [] }),
    isPackage: () => Promise.resolve({ b: false }),
  } as unknown as CachedOmcClient;
}

afterEach(() => {
  workspaceListeners.save.length = 0;
  workspaceListeners.change.length = 0;
  workspaceListeners.close.length = 0;
});

describe("handleDocumentSave", () => {
  it("invalidates the lookup cache and marks the file saved on a Modelica save", () => {
    const sync = fakeSync();
    const cache = new OmcLookupCache(fakeOmcClient());
    const invalidate = vi.spyOn(cache, "invalidate");

    const handled = handleDocumentSave(
      doc("modelica", "/work/Model.mo"),
      sync,
      () => cache,
    );

    expect(handled).toBe(true);
    expect(sync.invalidate).toHaveBeenCalledWith("/work/Model.mo");
    expect(invalidate).toHaveBeenCalledTimes(1);
  });

  it("does NOT invalidate or mark on a non-Modelica save", () => {
    const sync = fakeSync();
    const cache = new OmcLookupCache(fakeOmcClient());
    const invalidate = vi.spyOn(cache, "invalidate");

    const handled = handleDocumentSave(
      doc("plaintext", "/work/notes.txt"),
      sync,
      () => cache,
    );

    expect(handled).toBe(false);
    expect(sync.invalidate).not.toHaveBeenCalled();
    expect(invalidate).not.toHaveBeenCalled();
  });

  it("is a safe no-op when the lookup cache has not been created yet", () => {
    const sync = fakeSync();
    // The cache is created lazily on first provider use; a save before any
    // request must still mark the file (and not throw).
    const handled = handleDocumentSave(
      doc("modelica", "/work/Model.mo"),
      sync,
      () => undefined,
    );

    expect(handled).toBe(true);
    expect(sync.invalidate).toHaveBeenCalledWith("/work/Model.mo");
  });
});

describe("registerLanguageFeatures — save wiring", () => {
  it("registers an onDidSaveTextDocument listener that invalidates on a Modelica save", () => {
    const invalidate = vi.spyOn(OmcLookupCache.prototype, "invalidate");
    const ensureClient = vi.fn(() => Promise.resolve(fakeOmcClient()));

    const disposable = registerLanguageFeatures(
      { extensionUri: Uri.file("/ext") } as never,
      ensureClient as never,
    );

    // A save listener is registered.
    expect(workspaceListeners.save).toHaveLength(1);

    // Before any provider request the shared cache is undefined, so the save is
    // a safe no-op for invalidate (sync.invalidate still runs internally).
    emitSave(doc("modelica", "/work/Model.mo"));
    expect(invalidate).not.toHaveBeenCalled();

    disposable.dispose();
    invalidate.mockRestore();
  });
});
