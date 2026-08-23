/**
 * `runCheckModel`'s coordinate alignment for a class declared inline inside a
 * shared `package.mo`. Without the alignment step, a message OMC reports at
 * the file-relative line lands unshifted on the virtual `modelica-source:`
 * editor, which only ever shows the class's own pretty-printed text numbered
 * from line 1.
 *
 * `vscode` is aliased to the in-repo mock via the extension's vitest config.
 */

import { describe, expect, it, vi } from "vitest";
import * as vscode from "vscode";

import type { ErrorMessage } from "@dicode/omc-client";

import { log } from "../logger.js";

import { runCheckModel, type CheckModelClient } from "./check-model.js";

const PACKAGE_MO = "/ws/P/package.mo";

/**
 * `Foo.Bar` sits at lines 6-8 of `package.mo` — behind a sibling `Foo.Other`
 * (lines 2-4) — but its own standalone rendering, what `listFile("Foo.Bar")`
 * returns and what the virtual editor shows, starts at line 1.
 */
const STANDALONE_SOURCE = "model Bar\n  Real x;\nend Bar;";
const PACKAGE_SOURCE =
  "package Foo\n  model Other\n    Real y;\n  end Other;\n\n" +
  "  model Bar\n    Real x;\n  end Bar;\nend Foo;";
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
 * A shared-file class: `getSourceFile` reports the same file for `Foo.Bar`
 * and its enclosing `Foo` (so `fileOwnerClass` finds it shared), and
 * `getClassInformation` reports the buffer's own extent until `package.mo`
 * is reloaded, at which point it reports the file's real extent — mirroring
 * what `alignToSharedFile` expects from live OMC.
 */
function makeSharedFileClient(overrides: Partial<CheckModelClient> = {}) {
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
      contents: typeName === "Foo.Bar" ? STANDALONE_SOURCE : PACKAGE_SOURCE,
    })),
    loadString: vi.fn(async ({ data }: { data: string }) => {
      if (data === PACKAGE_SOURCE) renumbered = true;
      return { success: true };
    }),
    checkModel: vi.fn(async () => ({ result: "" })),
    getMessagesStringInternal: vi.fn(async () => ({
      messages: batches.shift() ?? [],
    })),
    ...overrides,
  } satisfies CheckModelClient;
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
  it("shifts a shared-file class's diagnostic onto the virtual buffer's own line", async () => {
    const { client, queue } = makeSharedFileClient();
    // File-relative line 7 (matching line 2 of the standalone rendering,
    // `Real x;`) is what OMC reports once package.mo is reloaded.
    queue([errorAt(PACKAGE_MO, 7, 5)]);
    const { diagnostics, set } = makeDiagnostics();

    await runCheckModel(client, diagnostics, "Foo.Bar");

    expect(set).toHaveBeenCalledTimes(1);
    const [uri, diags] = set.mock.calls[0] ?? [];
    expect((uri as vscode.Uri).toString()).toBe("modelica-source:/Foo.Bar.mo");
    expect(diags).toHaveLength(1);
    // Buffer line 2, column 3 (0-based for VSCode), not the file-relative
    // line 7 / column 5 OMC reports it at.
    expect(diags?.[0]?.range.start.line).toBe(1);
    expect(diags?.[0]?.range.start.character).toBe(2);
  });

  it("leaves a class that owns its file untouched, skipping the reload entirely", async () => {
    const ownFile = "/ws/Foo/Bar.mo";
    const bufferExtent = {
      lineNumberStart: 1,
      lineNumberEnd: 3,
      columnNumberStart: 1,
    };
    const listFile = vi.fn(async () => ({ contents: STANDALONE_SOURCE }));
    const loadString = vi.fn(async () => ({ success: true }));
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
      listFile,
      loadString,
      checkModel: vi.fn(async () => ({ result: "" })),
      getMessagesStringInternal: vi.fn(async () => ({
        messages: [errorAt(ownFile, 2, 3)],
      })),
    } satisfies CheckModelClient;
    const { diagnostics, set } = makeDiagnostics();

    await runCheckModel(client, diagnostics, "Foo.Bar");

    // Nothing shares the file, so `alignOwnSourceToSharedFile` returns before
    // ever touching `listFile`/`loadString` — no reload, no reparse.
    expect(listFile).not.toHaveBeenCalled();
    expect(loadString).not.toHaveBeenCalled();
    expect(set).toHaveBeenCalledTimes(1);
    const [uri, diags] = set.mock.calls[0] ?? [];
    expect((uri as vscode.Uri).toString()).toBe("modelica-source:/Foo.Bar.mo");
    expect(diags).toHaveLength(1);
    // The message's own line/column, just converted 1-based → 0-based.
    expect(diags?.[0]?.range.start.line).toBe(1);
    expect(diags?.[0]?.range.start.character).toBe(2);
  });

  it("counts errors/warnings from the unbounded messages, not the bounded set", async () => {
    // Foo.Other's diagnostic (line 3, inside its own body) falls outside
    // Foo.Bar's extent in the file and so is dropped from the published
    // squiggles, but the run's summary (and REPL mirror) must still reflect
    // it in the error count.
    const { client, queue } = makeSharedFileClient();
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

  it("publishes nothing for a shared-file class when the reload fails, while the summary still counts it", async () => {
    // Fail-closed: alignment can't be trusted, so nothing gets published for
    // this file rather than a squiggle at a possibly-wrong position — but the
    // check still ran and its outcome is still reported.
    const { client, queue } = makeSharedFileClient({
      loadString: vi.fn(async () => ({ success: false })),
    });
    queue([errorAt(PACKAGE_MO, 7, 5)]);
    const { diagnostics, set, clear } = makeDiagnostics();
    const infoSpy = vi.spyOn(log, "info");

    await runCheckModel(client, diagnostics, "Foo.Bar");

    expect(clear).toHaveBeenCalledTimes(1);
    expect(set).not.toHaveBeenCalled();
    const summaryCall = infoSpy.mock.calls.find(([, message]) =>
      String(message).includes("<<<"),
    );
    expect(summaryCall?.[1]).toContain("1 error");
    infoSpy.mockRestore();
  });
});
