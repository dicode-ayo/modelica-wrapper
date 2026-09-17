/**
 * `dispatchByName`'s error-buffer drain, exercised directly against fine
 * -grained control over when a mocked `invoke` resolves — the concurrency
 * invariant this pins needs that control, which the full MCP transport
 * `mcp-server.test.ts` drives doesn't give a test.
 */

import { describe, expect, it } from "vitest";

import {
  dispatchByName,
  type McpToolClient,
  type McpToolDeps,
} from "./dispatch.js";
import type { WriteVerdictSource } from "./write-verdict.js";

/** Every field `dispatchByName` and the write gate could touch, all inert. */
function baseClient(overrides: Partial<McpToolClient> = {}): McpToolClient {
  return {
    invoke: async () => ({ ok: true }),
    cd: async ({ newWorkingDirectory }) => ({
      workingDirectory: newWorkingDirectory,
    }),
    deleteClass: async () => ({ success: true }),
    existClass: async () => ({ exists: true }),
    getClassInformation: async () => ({
      fileReadOnly: false,
      fileName: "",
      restriction: "package",
    }),
    parseFile: async () => ({ classNames: [] }),
    parseString: async () => ({ classNames: [] }),
    getClassNames: async () => ({ classNames: [] }),
    getErrorString: async () => ({ errorString: "" }),
    loadString: async () => ({ success: true }),
    setSourceFile: async () => ({ success: true }),
    getSourceFile: async () => ({ fileName: "/w/Demo.mo" }),
    listFile: async () => ({ contents: "" }),
    getModelicaPath: async () => ({ modelicaPath: "/usr/lib/omlibrary" }),
    ...overrides,
  };
}

const verdicts: WriteVerdictSource = {
  forClass: async () => ({ ok: true }),
};

function text(result: {
  content: readonly { type: string; text?: string }[];
}): string {
  const [first] = result.content;
  if (first?.type !== "text" || first.text === undefined) {
    throw new Error("no text content");
  }
  return first.text;
}

describe("dispatchByName's error-buffer drain under concurrency", () => {
  it("does not let a slow call in flight lose its own diagnostic to a faster call's clear", async () => {
    // OMC really did leave a diagnostic as part of executing the slow call —
    // simulated here by setting the buffer as soon as its `invoke` runs —
    // but that call's own round trip is still pending when a second, faster
    // call starts. Without a lock around the whole clear-invoke-read
    // sequence, the faster call's own clear wipes the slow call's diagnostic
    // before the slow call ever reads it back.
    let buffer = "";
    let releaseSlow: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      releaseSlow = resolve;
    });
    let signalReachedGate: () => void = () => undefined;
    const reachedGate = new Promise<void>((resolve) => {
      signalReachedGate = resolve;
    });

    const client = baseClient({
      getErrorString: async () => {
        const errorString = buffer;
        buffer = "";
        return { errorString };
      },
      invoke: async (fn) => {
        if (fn === "addComponent") {
          buffer = "Error: An element with name R is already declared";
          signalReachedGate();
          await gate;
        }
        return { ok: true };
      },
    });
    const deps: McpToolDeps = { ensureClient: async () => client, verdicts };

    const slow = dispatchByName(deps, "addComponent", {
      componentName: "r1",
      componentClass: "Modelica.Electrical.Analog.Basic.Resistor",
      intoTypeName: "Demo.Circuit",
    });
    // Wait until the slow call has left its diagnostic and is blocked mid
    // round trip before starting the fast one, so the fast call's own
    // clear-invoke-read genuinely races the slow call's still-pending read.
    await reachedGate;
    const fastPromise = dispatchByName(deps, "getClassNames", {
      typeName: "Demo",
    });
    releaseSlow();
    const [slowResult, fast] = await Promise.all([slow, fastPromise]);

    expect(slowResult.isError).toBe(true);
    expect(text(slowResult)).toBe(
      "Error: An element with name R is already declared",
    );
    expect(fast.isError).toBeFalsy();
    expect(text(fast)).not.toContain("R is already declared");
  });
});
