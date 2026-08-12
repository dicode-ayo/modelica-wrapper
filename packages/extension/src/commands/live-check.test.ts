/**
 * The live-check pipeline's OMC contract: what filename the buffer is checked
 * under, which diagnostics that filename is allowed to bring back, and that a
 * read-only class is left alone.
 *
 * That the filename choice is the one preserving an inline member's place in
 * its file is pinned against a live OMC in
 * `packages/omc-client/test/loadString-filename.integration.test.ts`.
 *
 * `vscode` is aliased to the in-repo mock via the extension's vitest config.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as vscode from "vscode";
import type { ErrorMessage } from "@dicode/omc-client";

import {
  emitChange,
  workspaceListeners,
} from "../../test-support/vscode-mock.js";

import { WriteVerdicts } from "../write-verdict.js";

import type { CommandContext } from "./context.js";
import { registerLiveCheck, type LiveCheckClient } from "./live-check.js";

const DOC_URI = vscode.Uri.parse("modelica-source:/P.A.mo");
const PACKAGE_MO = "/ws/P/package.mo";
const DEBOUNCE_MS = 750;
const DOC_TEXT = "model A\n  Real x;\nend A;";
/** Diagnostics past the buffer's last line belong to another class. */
const DOC_LINES = DOC_TEXT.split("\n").length;

/**
 * `P.A` as `package.mo` holds it: indented one level, below a sibling. The
 * buffer above is the same class dedented to its own file, so OMC's positions
 * for it differ from the buffer's by 5 lines and 2 columns.
 */
const PACKAGE_SOURCE = [
  "package P",
  "  model Z",
  "    Real bad;",
  "  end Z;",
  "",
  "  model A",
  "    Real x;",
  "  end A;",
  "end P;",
].join("\n");
const A_IN_BUFFER = {
  lineNumberStart: 1,
  lineNumberEnd: DOC_LINES,
  columnNumberStart: 1,
};
const A_IN_FILE = {
  lineNumberStart: 6,
  lineNumberEnd: 8,
  columnNumberStart: 3,
};

/** `line` and `column` are 1-based, as OMC reports them. */
function errorAt(
  filename: string,
  message: string,
  line = 1,
  column = 1,
): ErrorMessage {
  return {
    info: {
      filename,
      readonly: false,
      lineStart: line,
      columnStart: column,
      lineEnd: line,
      columnEnd: column + 4,
    },
    message,
    kind: "translation",
    level: "error",
  };
}

/**
 * Records the calls the pipeline makes. Each queued batch drains on one read,
 * so a caller can aim messages at the parse stage or the semantic one.
 *
 * `getClassInformation` mirrors OMC: it reports the class inside whatever
 * string was loaded last, so the reload of `PACKAGE_SOURCE` is what moves it
 * from the buffer's coordinates to the file's.
 */
function makeClient(overrides: Partial<LiveCheckClient> = {}) {
  const batches: ErrorMessage[][] = [];
  let renumbered = false;
  const client = {
    getSourceFile: vi.fn(async () => ({ fileName: PACKAGE_MO })),
    getModelicaPath: vi.fn(async () => ({
      modelicaPath: "/home/u/.openmodelica/libraries",
    })),
    getClassInformation: vi.fn(async () => ({
      fileReadOnly: false,
      ...(renumbered ? A_IN_FILE : A_IN_BUFFER),
    })),
    getErrorString: vi.fn(async () => ({ errorString: "" })),
    parseString: vi.fn(async () => ({ classNames: ["P.A"] })),
    listFile: vi.fn(async () => ({ contents: PACKAGE_SOURCE })),
    loadString: vi.fn(async ({ data }: { data: string }) => {
      if (data === PACKAGE_SOURCE) renumbered = true;
      return { success: true };
    }),
    checkModel: vi.fn(async () => ({ result: "" })),
    getMessagesStringInternal: vi.fn(async () => ({
      messages: batches.shift() ?? [],
    })),
    ...overrides,
  } satisfies LiveCheckClient;
  return {
    client,
    queue(...stages: ErrorMessage[][]): void {
      batches.push(...stages);
    },
  };
}

function makeContext(client: LiveCheckClient) {
  const set = vi.fn();
  const ensureClient = vi.fn(async () => client);
  const ctx = {
    ensureClient,
    writeVerdicts: new WriteVerdicts(),
    diagnostics: { set } as unknown as vscode.DiagnosticCollection,
  } as unknown as CommandContext;
  return { ctx, set, ensureClient };
}

function changeEvent(text: string) {
  return {
    document: {
      uri: DOC_URI,
      getText: () => text,
      lineCount: text.split("\n").length,
    } as unknown as vscode.TextDocument,
    contentChanges: [{}],
  };
}

/**
 * More rounds than the pipeline has sequential awaits, so it reaches its end
 * within one call. Fake timers keep the debounce off the wall clock.
 */
const MICROTASK_DRAIN_ROUNDS = 50;

/** Fire a change and let the debounce plus the pipeline's awaits settle. */
async function runPipeline(text = DOC_TEXT): Promise<void> {
  emitChange(changeEvent(text));
  await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
  for (let i = 0; i < MICROTASK_DRAIN_ROUNDS; i++) {
    await Promise.resolve();
  }
}

let registered: vscode.Disposable | undefined;

/** Register the pipeline so `afterEach` disposes it even on a failed assertion. */
function register(ctx: CommandContext): void {
  registered = registerLiveCheck(ctx);
}

beforeEach(() => {
  vi.useFakeTimers();
  workspaceListeners.change.length = 0;
  workspaceListeners.configuration.length = 0;
});

afterEach(() => {
  registered?.dispose();
  registered = undefined;
  vi.useRealTimers();
});

describe("registerLiveCheck", () => {
  it("checks the buffer under the class's real source file, not its URI", async () => {
    const { client } = makeClient();
    const { ctx } = makeContext(client);
    register(ctx);

    await runPipeline();

    // A `modelica-source:` filename would drop `P.A` out of `package.mo`.
    expect(client.loadString).toHaveBeenCalledWith({
      data: DOC_TEXT,
      filename: PACKAGE_MO,
      merge: false,
    });
    expect(client.parseString).toHaveBeenCalledWith({
      data: DOC_TEXT,
      filename: PACKAGE_MO,
    });
  });

  it("routes diagnostics reported against that file back to the buffer", async () => {
    const { client, queue } = makeClient();
    const { ctx, set } = makeContext(client);
    queue([errorAt(PACKAGE_MO, "boom")]);
    register(ctx);

    await runPipeline();

    expect(set).toHaveBeenCalledTimes(1);
    const [uri, diags] = set.mock.calls[0] ?? [];
    expect(uri).toBe(DOC_URI);
    expect(diags).toHaveLength(1);
  });

  it("drops a diagnostic positioned past the buffer's last line", async () => {
    const { client, queue } = makeClient();
    const { ctx, set } = makeContext(client);
    // A sibling class further down the shared file; VSCode would clamp this
    // onto the buffer's last line.
    queue([errorAt(PACKAGE_MO, "sibling", DOC_LINES + 1)]);
    register(ctx);

    await runPipeline();

    expect(set).toHaveBeenCalledWith(DOC_URI, []);
  });

  it("keeps a diagnostic on the buffer's last line", async () => {
    const { client, queue } = makeClient();
    const { ctx, set } = makeContext(client);
    // A missing `end` reports against the final line — one past the boundary
    // the filter draws, and the user's own error.
    queue([errorAt(PACKAGE_MO, "missing end", DOC_LINES)]);
    register(ctx);

    await runPipeline();

    const [, diags] = set.mock.calls[0] ?? [];
    expect(diags).toHaveLength(1);
  });

  it("reloads the whole shared file before checking the class", async () => {
    const { client } = makeClient();
    const { ctx } = makeContext(client);
    register(ctx);

    await runPipeline();

    // Only the class that owns the file puts every class in it under one
    // coordinate space, which is what separates the members' diagnostics.
    expect(client.listFile).toHaveBeenCalledWith({ typeName: "P" });
    expect(client.loadString).toHaveBeenCalledWith({
      data: PACKAGE_SOURCE,
      filename: PACKAGE_MO,
      merge: false,
    });
  });

  it("carries the class's own diagnostic back into buffer coordinates", async () => {
    const { client, queue } = makeClient();
    const { ctx, set } = makeContext(client);
    // `Real x;` as the file holds it: line 7, column 5.
    queue([], [errorAt(PACKAGE_MO, "own", 7, 5)]);
    register(ctx);

    await runPipeline();

    const [, diags] = set.mock.calls[0] ?? [];
    expect(diags).toHaveLength(1);
    // Buffer line 2, column 3 — 0-based for VSCode.
    expect(diags?.[0]?.range.start.line).toBe(1);
    expect(diags?.[0]?.range.start.character).toBe(2);
  });

  it("drops a sibling's diagnostic that aliases a line of the buffer (#370)", async () => {
    const { client, queue } = makeClient();
    const { ctx, set } = makeContext(client);
    // `Z` is declared ahead of `A`, so its error carries a low line number
    // that is also a real line of the buffer. Bounding against the buffer's
    // own size cannot catch it; the class's extent in the file can.
    queue(
      [],
      [errorAt(PACKAGE_MO, "Variable bad not found in scope Z.", 3, 5)],
    );
    register(ctx);

    await runPipeline();

    expect(set).toHaveBeenCalledWith(DOC_URI, []);
  });

  it("leaves a class that owns its file in the buffer's own coordinates", async () => {
    const ownFile = "/ws/P/A.mo";
    const { client, queue } = makeClient({
      getSourceFile: vi.fn(async ({ typeName }: { typeName: string }) => ({
        fileName: typeName === "P.A" ? ownFile : PACKAGE_MO,
      })),
    });
    const { ctx, set } = makeContext(client);
    queue([], [errorAt(ownFile, "own", 2, 3)]);
    register(ctx);

    await runPipeline();

    expect(client.listFile).not.toHaveBeenCalled();
    const [, diags] = set.mock.calls[0] ?? [];
    expect(diags?.[0]?.range.start.line).toBe(1);
    expect(diags?.[0]?.range.start.character).toBe(2);
  });

  it("falls back to the buffer's bounds when the file cannot be reloaded", async () => {
    const { client, queue } = makeClient({
      listFile: vi.fn(async () => {
        throw new Error("no such class");
      }),
    });
    const { ctx, set } = makeContext(client);
    queue([], [errorAt(PACKAGE_MO, "own", 2), errorAt(PACKAGE_MO, "after", 9)]);
    register(ctx);

    await runPipeline();

    // Degrades to the guard a class with no siblings gets, rather than
    // dropping the run's diagnostics wholesale.
    const [, diags] = set.mock.calls[0] ?? [];
    expect(diags).toHaveLength(1);
    expect(diags?.[0]?.range.start.line).toBe(1);
  });

  it("keeps the buffer URI for a class with no on-disk source", async () => {
    const { client } = makeClient({
      getSourceFile: vi.fn(async () => ({ fileName: "<interactive>" })),
    });
    const { ctx } = makeContext(client);
    register(ctx);

    await runPipeline();

    expect(client.loadString).toHaveBeenCalledWith({
      data: DOC_TEXT,
      filename: DOC_URI.toString(),
      merge: false,
    });
  });

  it("skips the load stage for a buffer declaring several top-level classes (#452)", async () => {
    // Mid-edit the user has typed a second top-level class. `loadString` would
    // bind both to the real file, leaving OMC holding a shape no save can
    // write back. Parse diagnostics still publish.
    const { client } = makeClient({
      parseString: vi.fn(async () => ({ classNames: ["P.A", "P.B"] })),
    });
    const { ctx, set } = makeContext(client);
    register(ctx);

    await runPipeline();

    expect(client.parseString).toHaveBeenCalled();
    expect(client.loadString).not.toHaveBeenCalled();
    expect(client.checkModel).not.toHaveBeenCalled();
    // Such a buffer parses clean, so without a synthetic diagnostic the set
    // below would clear the user's squiggles and say nothing about why.
    const [, diagnostics] = set.mock.calls.at(-1) ?? [];
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics?.[0]?.message).toContain("P.A, P.B");
  });

  it("checks nothing for a class whose file OMC reports read-only", async () => {
    const { client } = makeClient({
      getClassInformation: vi.fn(async () => ({
        fileReadOnly: true,
        ...A_IN_BUFFER,
      })),
    });
    const { ctx, set } = makeContext(client);
    register(ctx);

    await runPipeline();

    // The gate sits above every mutating call, so an uneditable class is never
    // loaded back into OMC.
    expect(client.parseString).not.toHaveBeenCalled();
    expect(client.loadString).not.toHaveBeenCalled();
    expect(set).not.toHaveBeenCalled();
  });

  it("checks nothing for a system-library class whose file is writable", async () => {
    const { client } = makeClient({
      getSourceFile: vi.fn(async () => ({
        fileName: "/home/u/.openmodelica/libraries/Modelica 4.0.0/Blocks/A.mo",
      })),
      getClassInformation: vi.fn(async () => ({
        fileReadOnly: false,
        ...A_IN_BUFFER,
      })),
    });
    const { ctx, set } = makeContext(client);
    register(ctx);

    await runPipeline();

    expect(client.parseString).not.toHaveBeenCalled();
    expect(client.loadString).not.toHaveBeenCalled();
    expect(set).not.toHaveBeenCalled();
  });
});
