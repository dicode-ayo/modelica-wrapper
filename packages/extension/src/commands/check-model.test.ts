/**
 * `runCheckModel`'s coordinate alignment for a class declared inline inside a
 * shared `package.mo` (issue #462). Without the alignment step, a message
 * OMC reports at the file-relative line lands unshifted on the virtual
 * `modelica-source:` editor, which only ever shows the class's own
 * pretty-printed text numbered from line 1.
 *
 * `vscode` is aliased to the in-repo mock via the extension's vitest config.
 */

import { describe, expect, it, vi } from "vitest";
import * as vscode from "vscode";

import type { ErrorMessage, OmcClient } from "@dicode/omc-client";

import { log } from "../logger.js";

import { runCheckModel } from "./check-model.js";

const PACKAGE_MO = "/ws/P/package.mo";

/**
 * `Foo.Bar` sits at lines 6-8 of `package.mo` (a sibling declared ahead of
 * it), but its own standalone rendering — what `listFile("Foo.Bar")` returns
 * and what the virtual editor shows — starts at line 1.
 */
const STANDALONE_SOURCE = "model Bar\n  Real x;\nend Bar;";
const BAR_IN_BUFFER = {
  lineNumberStart: 1,
  lineNumberEnd: 3,
  columnNumberStart: 1,
};
const BAR_IN_FILE = {
  lineNumberStart: 6,
  lineNumberEnd: 8,
  columnNumberStart: 3,
};

/** `line`/`column` are 1-based, as OMC reports them. */
function errorAt(filename: string, line: number, column = 1): ErrorMessage {
  return {
    info: {
      filename,
      readonly: false,
      lineStart: line,
      columnStart: column,
      lineEnd: line,
      columnEnd: column + 4,
    },
    message: "boom",
    kind: "translation",
    level: "error",
    id: 1,
  };
}

/**
 * A shared-file class: `getClassInformation` reports the buffer's own extent
 * until `package.mo` is reloaded, at which point it reports the file's real
 * extent — mirroring what `alignToSharedFile` expects from live OMC.
 */
function makeSharedFileClient(overrides: Partial<OmcClient> = {}) {
  const batches: ErrorMessage[][] = [];
  let renumbered = false;
  const client = {
    getSourceFile: vi.fn(async () => ({ fileName: PACKAGE_MO })),
    getClassInformation: vi.fn(async () => ({
      fileName: PACKAGE_MO,
      ...(renumbered ? BAR_IN_FILE : BAR_IN_BUFFER),
    })),
    getErrorString: vi.fn(async () => ({ errorString: "" })),
    listFile: vi.fn(async ({ typeName }: { typeName: string }) => ({
      contents:
        typeName === "Foo.Bar" ? STANDALONE_SOURCE : "package P\nend P;",
    })),
    loadString: vi.fn(async ({ data }: { data: string }) => {
      if (data !== STANDALONE_SOURCE) renumbered = true;
      return { success: true };
    }),
    checkModel: vi.fn(async () => ({ result: "" })),
    getMessagesStringInternal: vi.fn(async () => ({
      messages: batches.shift() ?? [],
    })),
    ...overrides,
  } as unknown as OmcClient;
  return {
    client,
    queue(messages: ErrorMessage[]): void {
      batches.push(messages);
    },
  };
}

function makeDiagnostics(): {
  diagnostics: vscode.DiagnosticCollection;
  set: ReturnType<typeof vi.fn>;
  clear: ReturnType<typeof vi.fn>;
} {
  const set = vi.fn();
  const clear = vi.fn();
  return {
    diagnostics: { set, clear } as unknown as vscode.DiagnosticCollection,
    set,
    clear,
  };
}

describe("runCheckModel", () => {
  it("shifts a shared-file class's diagnostic onto the virtual buffer's own line (#462)", async () => {
    // getClassInformation resolves to the file owner P (`Foo.Bar`'s parent is
    // `Foo`, not sharing the same file as `Foo.Bar`) — but for this fixture
    // the class's own file IS the shared package.mo, so alignToSharedFile's
    // `fileOwnerClass` walk needs a distinct owner. Model that by having
    // getSourceFile report the same file for Foo.Bar and its enclosing scope
    // only up to "Foo", and a *different* file for "P" (the imaginary further
    // parent) so the walk stops at "Foo" as owner — i.e. Foo.Bar does NOT own
    // package.mo outright.
    const { client, queue } = makeSharedFileClient({
      getSourceFile: vi.fn(async ({ typeName }: { typeName: string }) =>
        typeName === "Foo.Bar" || typeName === "Foo"
          ? { fileName: PACKAGE_MO }
          : { fileName: "" },
      ),
    });
    // File-relative line 7 (matching line 2 of the standalone rendering,
    // `Real x;`) is what OMC reports once package.mo is reloaded.
    queue([errorAt(PACKAGE_MO, 7, 5)]);
    const { diagnostics, set } = makeDiagnostics();

    await runCheckModel(client, diagnostics, "Foo.Bar");

    expect(set).toHaveBeenCalledTimes(1);
    const [uri, diags] = set.mock.calls[0] ?? [];
    expect((uri as vscode.Uri).toString()).toBe("modelica-source:/Foo.Bar.mo");
    expect(diags).toHaveLength(1);
    // Buffer line 2, column 3 (0-based for VSCode) — NOT the raw file-relative
    // line 7/column 5 the pre-fix code would have published at.
    expect(diags?.[0]?.range.start.line).toBe(1);
    expect(diags?.[0]?.range.start.character).toBe(2);
  });

  it("leaves a class that owns its file with a no-op bound (common case, #462 non-regression)", async () => {
    const ownFile = "/ws/Foo/Bar.mo";
    const bufferExtent = {
      lineNumberStart: 1,
      lineNumberEnd: 3,
      columnNumberStart: 1,
    };
    const client = {
      // A distinct file for the enclosing package stops `fileOwnerClass`'s
      // walk immediately, so `Foo.Bar` is its own file's owner.
      getSourceFile: vi.fn(async ({ typeName }: { typeName: string }) => ({
        fileName: typeName === "Foo.Bar" ? ownFile : "/ws/Foo/package.mo",
      })),
      getClassInformation: vi.fn(async () => ({
        fileName: ownFile,
        ...bufferExtent,
      })),
      getErrorString: vi.fn(async () => ({ errorString: "" })),
      listFile: vi.fn(async () => ({ contents: STANDALONE_SOURCE })),
      loadString: vi.fn(async () => ({ success: true })),
      checkModel: vi.fn(async () => ({ result: "" })),
      getMessagesStringInternal: vi.fn(async () => ({
        messages: [errorAt(ownFile, 2, 3)],
      })),
    } as unknown as OmcClient;
    const { diagnostics, set } = makeDiagnostics();

    await runCheckModel(client, diagnostics, "Foo.Bar");

    expect(set).toHaveBeenCalledTimes(1);
    const [uri, diags] = set.mock.calls[0] ?? [];
    expect((uri as vscode.Uri).toString()).toBe("modelica-source:/Foo.Bar.mo");
    expect(diags).toHaveLength(1);
    // No shared file to align against — the message's own line/column, just
    // converted 1-based → 0-based.
    expect(diags?.[0]?.range.start.line).toBe(1);
    expect(diags?.[0]?.range.start.character).toBe(2);
  });

  it("counts errors/warnings from the unbounded messages, not the bounded set", async () => {
    // A sibling's diagnostic falls outside Foo.Bar's own extent in the file
    // and so is dropped from the published squiggles, but the run's summary
    // (and REPL mirror) must still reflect it in the error count.
    const { client, queue } = makeSharedFileClient({
      getSourceFile: vi.fn(async ({ typeName }: { typeName: string }) =>
        typeName === "Foo.Bar" || typeName === "Foo"
          ? { fileName: PACKAGE_MO }
          : { fileName: "" },
      ),
    });
    queue([errorAt(PACKAGE_MO, 3, 1), errorAt(PACKAGE_MO, 7, 5)]);
    const { diagnostics, set } = makeDiagnostics();
    const infoSpy = vi.spyOn(log, "info");

    await runCheckModel(client, diagnostics, "Foo.Bar");

    // Only the in-range message (line 7) survives into the published set...
    const [, diags] = set.mock.calls[0] ?? [];
    expect(diags).toHaveLength(1);
    // ...but the summary line still counts both errors: bounding is only for
    // squiggle placement, not for what the run reports as its outcome.
    const summaryCall = infoSpy.mock.calls.find(([, message]) =>
      String(message).includes("<<<"),
    );
    expect(summaryCall?.[1]).toContain("2 errors");
    infoSpy.mockRestore();
  });
});
