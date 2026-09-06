/**
 * Unit tests for the shared language-request procedure that
 * `ModelicaDefinitionProvider`, `ModelicaHoverProvider` and
 * `ModelicaCompletionProvider` each delegate to.
 *
 * `vscode` is the repo's mock; a minimal fake document/token stand in for the
 * editor (mirrors `document-scope.test.ts`), the parse cache and OMC client
 * are plain mocks, and `compute`/`map` are spies — this suite pins the
 * procedure itself (ordering, cancellation, error handling), not any one
 * feature. `map` is the identity function in most cases below; the happy-path
 * test is the one that pins that it runs at all.
 */

import { describe, expect, it, vi } from "vitest";

import type { Tree } from "web-tree-sitter";

import type * as vscode from "vscode";

vi.mock("../logger.js", () => ({
  log: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    show: vi.fn(),
    dispose: vi.fn(),
  },
}));

import { log } from "../logger.js";

import type { DocumentSync } from "./document-scope.js";
import {
  runLanguageRequest,
  type RequestParseCache,
} from "./language-request.js";
import type { OwningClassClient } from "./owning-class.js";

/** A `modelica-source:` document: `resolveDocumentOwner` derives its FQN from
 *  the path alone, with no filesystem walk or client call — the cheapest way
 *  to get past the owning-class step deterministically. */
function virtualDocument(fqn: string): vscode.TextDocument {
  return {
    uri: { scheme: "modelica-source", fsPath: `/${fqn}.mo` },
    offsetAt: vi.fn(() => 7),
  } as unknown as vscode.TextDocument;
}

/** A real `.mo`-less path: `resolveOwningClass` returns `undefined` for it,
 *  with no client call either — used to exercise the "no owner" branch. */
function unresolvableDocument(): vscode.TextDocument {
  return {
    uri: { scheme: "file", fsPath: "/work/notes.txt" },
    offsetAt: vi.fn(() => 0),
  } as unknown as vscode.TextDocument;
}

function token(isCancellationRequested = false): vscode.CancellationToken {
  return { isCancellationRequested } as vscode.CancellationToken;
}

function fakeCache(tree: Tree = {} as Tree): RequestParseCache {
  return { parse: vi.fn(() => Promise.resolve(tree)) };
}

function fakeSync(): DocumentSync {
  return { ensureLoaded: vi.fn(() => Promise.resolve(true)) };
}

function fakeClient(): OwningClassClient {
  return { parseFile: vi.fn(() => Promise.resolve({ classNames: [] })) };
}

/** The identity `map` — most tests below assert on `compute`'s raw result. */
function identity<T>(result: T): T {
  return result;
}

describe("runLanguageRequest — owning class", () => {
  it("returns undefined and never calls compute when no owning class resolves", async () => {
    const compute = vi.fn();
    const result = await runLanguageRequest(
      unresolvableDocument(),
      {} as vscode.Position,
      token(),
      {
        cache: fakeCache(),
        ensureClient: () => Promise.resolve(fakeClient()),
        sync: fakeSync(),
        compute,
        map: identity,
        recheckTokenAfterCompute: false,
        failureContext: "test provider failed",
      },
    );
    expect(result).toBeUndefined();
    expect(compute).not.toHaveBeenCalled();
  });
});

describe("runLanguageRequest — load-on-touch", () => {
  it("resolves and loads a real file's owning class before parsing and computing", async () => {
    const filePath = "/work/Foo.mo";
    const calls: string[] = [];
    const ensureLoaded = vi.fn((path: string) => {
      calls.push(`ensureLoaded:${path}`);
      return Promise.resolve(true);
    });
    const client: OwningClassClient = {
      parseFile: vi.fn(() => Promise.resolve({ classNames: ["Foo"] })),
    };
    const cache: RequestParseCache = {
      parse: vi.fn(() => {
        calls.push("parse");
        return Promise.resolve({} as Tree);
      }),
    };
    const compute = vi.fn((_tree, _offset, owningClass: string) => {
      calls.push(`compute:${owningClass}`);
      return Promise.resolve({ value: 1 });
    });
    const document = {
      uri: { scheme: "file", fsPath: filePath },
      offsetAt: vi.fn(() => 0),
    } as unknown as vscode.TextDocument;

    const result = await runLanguageRequest(
      document,
      {} as vscode.Position,
      token(),
      {
        cache,
        ensureClient: () => Promise.resolve(client),
        sync: { ensureLoaded },
        // No package.mo above `filePath` — mirrors `document-scope.test.ts`'s
        // `noPackages` probe rather than depending on the real filesystem.
        probe: () => Promise.resolve(false),
        compute,
        map: identity,
        recheckTokenAfterCompute: false,
        failureContext: "test provider failed",
      },
    );

    expect(calls).toEqual([`ensureLoaded:${filePath}`, "parse", "compute:Foo"]);
    expect(result).toEqual({ value: 1 });
  });
});

describe("runLanguageRequest — cancellation before compute", () => {
  it("returns undefined and never calls compute or parses when already cancelled", async () => {
    const compute = vi.fn();
    const cache = fakeCache();
    const result = await runLanguageRequest(
      virtualDocument("Pkg.Foo"),
      {} as vscode.Position,
      token(true),
      {
        cache,
        ensureClient: () => Promise.resolve(fakeClient()),
        sync: fakeSync(),
        compute,
        map: identity,
        recheckTokenAfterCompute: false,
        failureContext: "test provider failed",
      },
    );
    expect(result).toBeUndefined();
    expect(compute).not.toHaveBeenCalled();
    expect(cache.parse).not.toHaveBeenCalled();
  });
});

describe("runLanguageRequest — happy path", () => {
  it("parses, computes, maps, and returns the result with the derived owning class", async () => {
    const tree = { marker: "tree" } as unknown as Tree;
    const cache = fakeCache(tree);
    const client = fakeClient();
    const compute = vi.fn(() => Promise.resolve({ value: 42 }));
    const map = vi.fn((result: { value: number }) => `mapped:${result.value}`);

    const result = await runLanguageRequest(
      virtualDocument("Pkg.Foo"),
      {} as vscode.Position,
      token(),
      {
        cache,
        ensureClient: () => Promise.resolve(client),
        sync: fakeSync(),
        compute,
        map,
        recheckTokenAfterCompute: false,
        failureContext: "test provider failed",
      },
    );

    expect(result).toBe("mapped:42");
    expect(compute).toHaveBeenCalledWith(tree, 7, "Pkg.Foo", client);
    expect(map).toHaveBeenCalledWith({ value: 42 });
  });

  it("returns undefined without calling map when compute resolves to undefined", async () => {
    const compute = vi.fn(() => Promise.resolve(undefined));
    const map = vi.fn();

    const result = await runLanguageRequest(
      virtualDocument("Pkg.Foo"),
      {} as vscode.Position,
      token(),
      {
        cache: fakeCache(),
        ensureClient: () => Promise.resolve(fakeClient()),
        sync: fakeSync(),
        compute,
        map,
        recheckTokenAfterCompute: false,
        failureContext: "test provider failed",
      },
    );

    expect(result).toBeUndefined();
    expect(map).not.toHaveBeenCalled();
  });

  it("returns undefined when map itself reports no result (e.g. an empty candidate list)", async () => {
    const compute = vi.fn(() => Promise.resolve({ value: 1 }));

    const result = await runLanguageRequest(
      virtualDocument("Pkg.Foo"),
      {} as vscode.Position,
      token(),
      {
        cache: fakeCache(),
        ensureClient: () => Promise.resolve(fakeClient()),
        sync: fakeSync(),
        compute,
        map: () => undefined,
        recheckTokenAfterCompute: false,
        failureContext: "test provider failed",
      },
    );

    expect(result).toBeUndefined();
  });
});

describe("runLanguageRequest — cancellation during compute", () => {
  it("keeps compute's result when recheckTokenAfterCompute is false, even if cancelled meanwhile", async () => {
    const t = token(false);
    const compute = vi.fn(() => {
      // Simulate the cursor moving on while `compute` was mid-flight.
      Object.assign(t, { isCancellationRequested: true });
      return Promise.resolve({ value: 1 });
    });

    const result = await runLanguageRequest(
      virtualDocument("Pkg.Foo"),
      {} as vscode.Position,
      t,
      {
        cache: fakeCache(),
        ensureClient: () => Promise.resolve(fakeClient()),
        sync: fakeSync(),
        compute,
        map: identity,
        recheckTokenAfterCompute: false,
        failureContext: "test provider failed",
      },
    );

    expect(result).toEqual({ value: 1 });
  });

  it("discards compute's result when recheckTokenAfterCompute is true and cancelled meanwhile", async () => {
    const t = token(false);
    const compute = vi.fn(() => {
      Object.assign(t, { isCancellationRequested: true });
      return Promise.resolve({ value: 1 });
    });

    const result = await runLanguageRequest(
      virtualDocument("Pkg.Foo"),
      {} as vscode.Position,
      t,
      {
        cache: fakeCache(),
        ensureClient: () => Promise.resolve(fakeClient()),
        sync: fakeSync(),
        compute,
        map: identity,
        recheckTokenAfterCompute: true,
        failureContext: "test provider failed",
      },
    );

    expect(result).toBeUndefined();
  });
});

describe("runLanguageRequest — never throws out", () => {
  it("swallows a thrown error from compute, logs it, and returns undefined", async () => {
    const compute = vi.fn(() => Promise.reject(new Error("boom")));

    const result = await runLanguageRequest(
      virtualDocument("Pkg.Foo"),
      {} as vscode.Position,
      token(),
      {
        cache: fakeCache(),
        ensureClient: () => Promise.resolve(fakeClient()),
        sync: fakeSync(),
        compute,
        map: identity,
        recheckTokenAfterCompute: false,
        failureContext: "test provider failed",
      },
    );

    expect(result).toBeUndefined();
    expect(log.error).toHaveBeenCalledWith(
      "language",
      "test provider failed",
      expect.any(Error),
    );
  });

  it("swallows a thrown error from ensureClient and logs it", async () => {
    const result = await runLanguageRequest(
      virtualDocument("Pkg.Foo"),
      {} as vscode.Position,
      token(),
      {
        cache: fakeCache(),
        ensureClient: () => Promise.reject(new Error("no client")),
        sync: fakeSync(),
        compute: vi.fn(),
        map: identity,
        recheckTokenAfterCompute: false,
        failureContext: "test provider failed",
      },
    );

    expect(result).toBeUndefined();
    expect(log.error).toHaveBeenCalledWith(
      "language",
      "test provider failed",
      expect.any(Error),
    );
  });

  it("swallows a thrown error from map and logs it", async () => {
    const result = await runLanguageRequest(
      virtualDocument("Pkg.Foo"),
      {} as vscode.Position,
      token(),
      {
        cache: fakeCache(),
        ensureClient: () => Promise.resolve(fakeClient()),
        sync: fakeSync(),
        compute: vi.fn(() => Promise.resolve({ value: 1 })),
        map: () => {
          throw new Error("mapping failed");
        },
        recheckTokenAfterCompute: false,
        failureContext: "test provider failed",
      },
    );

    expect(result).toBeUndefined();
    expect(log.error).toHaveBeenCalledWith(
      "language",
      "test provider failed",
      expect.any(Error),
    );
  });
});
