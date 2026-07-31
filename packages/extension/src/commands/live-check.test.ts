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

import type { ModelicaSourceProvider } from "../source-provider.js";

import type { CommandContext } from "./context.js";
import { registerLiveCheck, type LiveCheckClient } from "./live-check.js";

const DOC_URI = vscode.Uri.parse("modelica-source:/P.A.mo");
const PACKAGE_MO = "/ws/P/package.mo";
const DEBOUNCE_MS = 750;
const DOC_TEXT = "model A\n  Real x;\nend A;";
/** Diagnostics past the buffer's last line belong to another class. */
const DOC_LINES = DOC_TEXT.split("\n").length;

/** `line` is 1-based, as OMC reports it. */
function errorAt(filename: string, message: string, line = 1): ErrorMessage {
  return {
    info: {
      filename,
      readonly: false,
      lineStart: line,
      columnStart: 1,
      lineEnd: line,
      columnEnd: 5,
    },
    message,
    kind: "translation",
    level: "error",
  };
}

/** Records the calls the pipeline makes; queued messages drain per read. */
function makeClient(overrides: Partial<LiveCheckClient> = {}) {
  let pending: ErrorMessage[] = [];
  const client = {
    getSourceFile: vi.fn(async () => ({ fileName: PACKAGE_MO })),
    getErrorString: vi.fn(async () => ({ errorString: "" })),
    parseString: vi.fn(async () => ({ names: ["P.A"] })),
    loadString: vi.fn(async () => ({ success: true })),
    checkModel: vi.fn(async () => ({ result: "" })),
    // The class spans the whole shared file by default, matching DOC_TEXT,
    // so the bounds the pipeline derives from this equal the buffer's own
    // and every existing buffer-relative assumption below still holds;
    // tests that care override it explicitly.
    getClassInformation: vi.fn(async () => ({
      lineNumberStart: 1,
      lineNumberEnd: DOC_LINES,
    })),
    getMessagesStringInternal: vi.fn(async () => {
      const messages = pending;
      pending = [];
      return { messages };
    }),
    ...overrides,
  } satisfies LiveCheckClient;
  return {
    client,
    queue(messages: ErrorMessage[]): void {
      pending = messages;
    },
  };
}

/**
 * A client whose `getMessagesStringInternal` returns a different batch on
 * each successive call — the pipeline reads it once after `parseString` and
 * once after `checkModel`, and only the second batch goes through the
 * sibling-file line-offset shift.
 */
function makeSequencedClient(
  responses: readonly ErrorMessage[][],
  overrides: Partial<LiveCheckClient> = {},
) {
  let call = 0;
  const getMessagesStringInternal = vi.fn(async () => {
    const messages = responses[call] ?? [];
    call++;
    return { messages };
  });
  return makeClient({ getMessagesStringInternal, ...overrides }).client;
}

function makeContext(client: LiveCheckClient, readOnly = false) {
  const set = vi.fn();
  const ensureClient = vi.fn(async () => client);
  // Typed against the provider so a rename there fails the build rather than
  // leaving a green test whose read-only gate silently stopped firing.
  const sourceProvider: Pick<ModelicaSourceProvider, "isReadOnly"> = {
    isReadOnly: vi.fn(async () => readOnly),
  };
  const ctx = {
    ensureClient,
    sourceProvider,
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

  it("checks nothing for a class the source provider reports read-only", async () => {
    const { client } = makeClient();
    const { ctx, set, ensureClient } = makeContext(client, true);
    register(ctx);

    await runPipeline();

    // The gate sits above the client, so a read-only class never even spawns
    // OMC on a workspace that hasn't needed it yet.
    expect(ensureClient).not.toHaveBeenCalled();
    expect(client.parseString).not.toHaveBeenCalled();
    expect(client.loadString).not.toHaveBeenCalled();
    expect(set).not.toHaveBeenCalled();
  });

  describe("a class stored ahead of siblings in a shared file", () => {
    // The post-load `getClassInformation` says `A` now spans file lines
    // [6, 8] — e.g. a sibling declared first occupies lines 1-5 of
    // `package.mo`, and OMC reports `A`'s own diagnostics file-relative.
    const CLASS_START_LINE = 6;
    const CLASS_END_LINE = CLASS_START_LINE + DOC_LINES - 1;

    it("drops a sibling's diagnostic even though its line falls inside the buffer's own range", async () => {
      const client = makeSequencedClient(
        [
          [], // parseString read: nothing
          // checkModel read: a diagnostic against the sibling declared ahead,
          // at its real (small) file-relative line — inside [1, DOC_LINES]
          // exactly like a diagnostic for the buffer itself would be.
          [errorAt(PACKAGE_MO, "sibling error", 2)],
        ],
        {
          getClassInformation: vi.fn(async () => ({
            lineNumberStart: CLASS_START_LINE,
            lineNumberEnd: CLASS_END_LINE,
          })),
        },
      );
      const { ctx, set } = makeContext(client);
      register(ctx);

      await runPipeline();

      expect(set).toHaveBeenCalledWith(DOC_URI, []);
    });

    it("shifts the edited class's own diagnostic back to buffer-relative coordinates", async () => {
      // Buffer line 2 ("Real x;") reported at its real file line: 6 + (2-1).
      const fileRelativeLine = CLASS_START_LINE + 1;
      const client = makeSequencedClient(
        [[], [errorAt(PACKAGE_MO, "own error", fileRelativeLine)]],
        {
          getClassInformation: vi.fn(async () => ({
            lineNumberStart: CLASS_START_LINE,
            lineNumberEnd: CLASS_END_LINE,
          })),
        },
      );
      const { ctx, set } = makeContext(client);
      register(ctx);

      await runPipeline();

      const [uri, diags] = set.mock.calls[0] ?? [];
      expect(uri).toBe(DOC_URI);
      expect(diags).toHaveLength(1);
      expect((diags as vscode.Diagnostic[])[0]?.range.start.line).toBe(1);
    });

    it("drops a sibling declared after the edited class in the same file", async () => {
      // Real file line past the class's own [6, 8] span (3-line DOC_TEXT).
      const client = makeSequencedClient(
        [[], [errorAt(PACKAGE_MO, "later sibling", CLASS_END_LINE + 10)]],
        {
          getClassInformation: vi.fn(async () => ({
            lineNumberStart: CLASS_START_LINE,
            lineNumberEnd: CLASS_END_LINE,
          })),
        },
      );
      const { ctx, set } = makeContext(client);
      register(ctx);

      await runPipeline();

      expect(set).toHaveBeenCalledWith(DOC_URI, []);
    });

    it("grows the class's own bounds when the buffer has grown since the last reload", async () => {
      // The "residual leak" case: if the class's *current* size (not a stale
      // pre-edit snapshot) weren't used as the upper bound, a sibling that
      // used to sit just past the class's old, smaller extent could shift
      // into what looks like a valid buffer line once the buffer grows.
      // `keepWithinBuffer` is driven by the post-load range, which — by
      // construction — already reflects the buffer's current size, so the
      // sibling here (originally just past the class's *old* end) stays
      // outside the *current*, larger end and is still dropped.
      const grownText = `${DOC_TEXT}\n  Real y;\n  Real z;`; // 5 lines now
      const grownEnd = CLASS_START_LINE + grownText.split("\n").length - 1; // 10
      const client = makeSequencedClient(
        [[], [errorAt(PACKAGE_MO, "later sibling", grownEnd + 1)]],
        {
          getClassInformation: vi.fn(async () => ({
            lineNumberStart: CLASS_START_LINE,
            lineNumberEnd: grownEnd,
          })),
        },
      );
      const { ctx, set } = makeContext(client);
      register(ctx);

      await runPipeline(grownText);

      expect(set).toHaveBeenCalledWith(DOC_URI, []);
    });
  });
});
