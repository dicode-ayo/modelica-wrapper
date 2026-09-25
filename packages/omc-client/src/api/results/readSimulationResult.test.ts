import { describe, expect, it } from "vitest";

import type { CallContext } from "../../_shared/callContext.js";
import { OmcDiagnosticError } from "../../error-buffer.js";

import { readSimulationResult } from "./readSimulationResult.js";

/**
 * A `CallContext` answering from `responses`, with `errorString` standing in
 * for OMC's buffer. `reads` counts the buffer reads a wrapper spent, which is
 * what separates a wrapper that asks for a reason from one that does not.
 */
export function stubCtx(
  responses: Record<string, string>,
  errorString = "",
): { ctx: CallContext; sent: string[]; reads: () => number } {
  const sent: string[] = [];
  let reads = 0;
  const ctx: CallContext = {
    async call(cmd) {
      sent.push(cmd);
      const response = responses[cmd];
      if (response === undefined) {
        throw new Error(`stubCtx: no response configured for "${cmd}"`);
      }
      return response;
    },
    async getErrorString() {
      reads += 1;
      return { errorString };
    },
  };
  return { ctx, sent, reads: () => reads };
}

describe("readSimulationResult: size = 0 resolution", () => {
  it("resolves size via readSimulationResultSize instead of passing 0 through", async () => {
    const { ctx, sent } = stubCtx({
      'readSimulationResultSize("run.csv")': "12",
      'readSimulationResult("run.csv", {time, x}, 12)':
        "{{0.0, 0.1}, {1.0, 0.9}}",
    });

    const out = await readSimulationResult(ctx, {
      filename: "run.csv",
      variables: ["time", "x"],
    });

    expect(out.result).toEqual([
      [0.0, 0.1],
      [1.0, 0.9],
    ]);
    expect(sent).toEqual([
      'readSimulationResultSize("run.csv")',
      'readSimulationResult("run.csv", {time, x}, 12)',
    ]);
  });

  it("passes an explicit non-zero size straight through, without resolving it", async () => {
    const { ctx, sent } = stubCtx({
      'readSimulationResult("run.mat", {time, x}, 12)':
        "{{0.0, 0.1}, {1.0, 0.9}}",
    });

    await readSimulationResult(ctx, {
      filename: "run.mat",
      variables: ["time", "x"],
      size: 12,
    });

    expect(sent).toEqual(['readSimulationResult("run.mat", {time, x}, 12)']);
  });

  it("returns one empty row per variable, without a readSimulationResult call, when the file has 0 rows", async () => {
    const { ctx, sent } = stubCtx({
      'readSimulationResultSize("empty.csv")': "0",
    });

    const out = await readSimulationResult(ctx, {
      filename: "empty.csv",
      variables: ["time", "x"],
    });

    // Empty, but still one row per requested variable — the documented shape.
    expect(out.result).toEqual([[], []]);
    // Passing the resolved 0 through to readSimulationResult would reach
    // exactly the OMC bug this function exists to avoid.
    expect(sent).toEqual(['readSimulationResultSize("empty.csv")']);
  });
});

describe("readSimulationResult: OMC error replies", () => {
  it("surfaces OMC's own diagnostic rather than 'expected list/tuple, got call'", async () => {
    // OMC answers with a call-shaped diagnostic rather than the documented
    // `fail()` sentinel this wrapper already special-cases.
    const { ctx } = stubCtx({
      'readSimulationResult("missing.mat", {time}, 1)':
        'Error("no such file: missing.mat")',
    });
    const input = { filename: "missing.mat", variables: ["time"], size: 1 };

    await expect(readSimulationResult(ctx, input)).rejects.toThrow(
      new OmcDiagnosticError("Error: no such file: missing.mat"),
    );
  });
});
