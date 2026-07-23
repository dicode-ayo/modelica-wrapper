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
});
