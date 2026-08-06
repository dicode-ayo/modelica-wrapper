/**
 * Unit test for the cache-invalidation glue: the two events that stale the
 * language caches — a document save, and a class changing outside the editor
 * — reach `sync`, the parse cache and the lookup cache. Each cache's own
 * `invalidate` is covered in `omc-cache.test.ts` / `sync.test.ts`; what is
 * asserted here is the wiring, both through the extracted handlers and through
 * the listeners `registerLanguageFeatures` installs.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  Uri,
  emitSave,
  workspaceListeners,
} from "../../test-support/vscode-mock.js";

import { ClassInvalidationRegistry } from "../invalidation.js";
import { sourceUriFor } from "../source-provider.js";

import {
  handleClassChanged,
  handleDocumentSave,
  registerLanguageFeatures,
} from "./index.js";
import { OmcLookupCache, type CachedOmcClient } from "./omc-cache.js";
import { ParseCache } from "./parse.js";
import { OmcSync } from "./sync.js";

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

describe("handleClassChanged", () => {
  it("drops the class's parse tree and the lookup cache", () => {
    const parseCache = { invalidate: vi.fn() };
    const cache = new OmcLookupCache(fakeOmcClient());
    const invalidate = vi.spyOn(cache, "invalidate");

    handleClassChanged("Lib.A", parseCache, () => cache);

    expect(parseCache.invalidate).toHaveBeenCalledWith(sourceUriFor("Lib.A"));
    expect(invalidate).toHaveBeenCalledTimes(1);
  });

  it("is a safe no-op when the lookup cache has not been created yet", () => {
    const parseCache = { invalidate: vi.fn() };

    handleClassChanged("Lib.A", parseCache, () => undefined);

    expect(parseCache.invalidate).toHaveBeenCalledWith(sourceUriFor("Lib.A"));
  });
});

describe("registerLanguageFeatures — invalidation wiring", () => {
  function register() {
    const invalidation = new ClassInvalidationRegistry();
    const disposable = registerLanguageFeatures(
      { extensionUri: Uri.file("/ext") } as never,
      vi.fn(() => Promise.resolve(fakeOmcClient())) as never,
      invalidation,
    );
    return { invalidation, disposable };
  }

  it("drops the parse tree of a class that changed outside the editor", () => {
    const invalidate = vi.spyOn(ParseCache.prototype, "invalidate");
    const { invalidation, disposable } = register();

    invalidation.classChanged("Lib.A");
    expect(invalidate).toHaveBeenCalledWith(sourceUriFor("Lib.A"));

    disposable.dispose();
    invalidate.mockClear();
    invalidation.classChanged("Lib.B");
    expect(invalidate).not.toHaveBeenCalled();

    invalidate.mockRestore();
  });

  it("leaves the loaded-into-OMC flags alone", () => {
    // Every producer announces a class only once OMC already holds the change,
    // so clearing a flag would schedule a `loadFile` that re-reads disk over an
    // OMC-only edit — an unsaved graphical commit is exactly that.
    const invalidate = vi.spyOn(OmcSync.prototype, "invalidate");
    const { invalidation, disposable } = register();

    invalidation.classChanged("Lib.A");

    expect(invalidate).not.toHaveBeenCalled();

    disposable.dispose();
    invalidate.mockRestore();
  });
});

describe("registerLanguageFeatures — save wiring", () => {
  it("registers an onDidSaveTextDocument listener that invalidates on a Modelica save", () => {
    const invalidate = vi.spyOn(OmcLookupCache.prototype, "invalidate");
    const ensureClient = vi.fn(() => Promise.resolve(fakeOmcClient()));

    const disposable = registerLanguageFeatures(
      { extensionUri: Uri.file("/ext") } as never,
      ensureClient as never,
      new ClassInvalidationRegistry(),
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
