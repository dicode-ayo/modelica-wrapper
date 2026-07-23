/**
 * The live-check pipeline's OMC contract: what filename the buffer is checked
 * under, and that a read-only buffer never reaches OMC at all.
 *
 * `vscode` is aliased to the in-repo mock via the extension's vitest config.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as vscode from "vscode";
import type { OmcClient, ErrorMessage } from "@dicode/omc-client";

import {
  emitChange,
  setStatReadonly,
  workspaceListeners,
} from "../../test-support/vscode-mock.js";

import type { CommandContext } from "./context.js";
import { registerLiveCheck } from "./live-check.js";

const DOC_URI = vscode.Uri.parse("modelica-source:/P.A.mo");
const PACKAGE_MO = "/ws/P/package.mo";
const DEBOUNCE_MS = 750;

function errorAt(filename: string, message: string): ErrorMessage {
  return {
    info: {
      filename,
      readonly: false,
      lineStart: 3,
      columnStart: 1,
      lineEnd: 3,
      columnEnd: 5,
    },
    message,
    kind: "translation",
    level: "error",
  };
}

/** Records the calls the pipeline makes; `messages` is drained per read. */
function makeClient(overrides: Partial<Record<string, unknown>> = {}) {
  const loadString = vi.fn(async () => ({ success: true }));
  const parseString = vi.fn(async () => ({ names: ["P.A"] }));
  const checkModel = vi.fn(async () => ({ result: "" }));
  let pending: ErrorMessage[] = [];
  const client = {
    getSourceFile: vi.fn(async () => ({ fileName: PACKAGE_MO })),
    getErrorString: vi.fn(async () => ({ errorString: "" })),
    parseString,
    loadString,
    checkModel,
    getMessagesStringInternal: vi.fn(async () => {
      const messages = pending;
      pending = [];
      return { messages };
    }),
    ...overrides,
  };
  return {
    client: client as unknown as OmcClient,
    loadString,
    parseString,
    checkModel,
    getSourceFile: client.getSourceFile,
    queue(messages: ErrorMessage[]): void {
      pending = messages;
    },
  };
}

function makeContext(client: OmcClient) {
  const set = vi.fn();
  const ctx = {
    ensureClient: async () => client,
    diagnostics: { set } as unknown as vscode.DiagnosticCollection,
  } as unknown as CommandContext;
  return { ctx, set };
}

function changeEvent(text: string) {
  return {
    document: {
      uri: DOC_URI,
      getText: () => text,
    } as unknown as vscode.TextDocument,
    contentChanges: [{}],
  };
}

/** Fire a change and let the debounce plus the pipeline's awaits settle. */
async function runPipeline(text = "model A end A;"): Promise<void> {
  emitChange(changeEvent(text));
  await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
  // The pipeline is a chain of awaits behind the check lock; drain the
  // microtask queue until it runs out rather than counting the steps.
  for (let i = 0; i < 50; i++) await Promise.resolve();
}

beforeEach(() => {
  vi.useFakeTimers();
  setStatReadonly(false);
  workspaceListeners.change.length = 0;
});

afterEach(() => {
  vi.useRealTimers();
});

describe("registerLiveCheck", () => {
  it("checks the buffer under the class's real source file, not its URI", async () => {
    const { client, loadString, parseString } = makeClient();
    const { ctx } = makeContext(client);
    const sub = registerLiveCheck(ctx);

    await runPipeline();

    // A `modelica-source:` filename would evict `P.A` from `package.mo`,
    // dropping its siblings on the next save.
    expect(loadString).toHaveBeenCalledWith({
      data: "model A end A;",
      filename: PACKAGE_MO,
    });
    expect(parseString).toHaveBeenCalledWith({
      data: "model A end A;",
      filename: PACKAGE_MO,
    });
    sub.dispose();
  });

  it("routes diagnostics reported against that file back to the buffer", async () => {
    const harness = makeClient();
    const { ctx, set } = makeContext(harness.client);
    harness.queue([errorAt(PACKAGE_MO, "boom")]);
    const sub = registerLiveCheck(ctx);

    await runPipeline();

    expect(set).toHaveBeenCalledTimes(1);
    const [uri, diags] = set.mock.calls[0] ?? [];
    expect(uri).toBe(DOC_URI);
    expect(diags).toHaveLength(1);
    sub.dispose();
  });

  it("keeps the buffer URI for a class with no on-disk source", async () => {
    const { client, loadString } = makeClient({
      getSourceFile: vi.fn(async () => ({ fileName: "<interactive>" })),
    });
    const { ctx } = makeContext(client);
    const sub = registerLiveCheck(ctx);

    await runPipeline();

    expect(loadString).toHaveBeenCalledWith({
      data: "model A end A;",
      filename: DOC_URI.toString(),
    });
    sub.dispose();
  });

  it("never touches OMC for a read-only document", async () => {
    const { client, loadString, parseString } = makeClient();
    const { ctx, set } = makeContext(client);
    setStatReadonly(true);
    const sub = registerLiveCheck(ctx);

    await runPipeline();

    expect(parseString).not.toHaveBeenCalled();
    expect(loadString).not.toHaveBeenCalled();
    expect(set).not.toHaveBeenCalled();
    sub.dispose();
  });
});
