import { describe, expect, it } from "vitest";

import type { CallContext } from "../../_shared/callContext.js";
import { OmcDiagnosticError } from "../../error-buffer.js";

import { readSimulationResult } from "./readSimulationResult.js";

/**
 * A `CallContext` answering from `responses`, with `errorString` standing in
 * for OMC's buffer. `reads` counts the buffer reads a wrapper spent, which is
 * what separates a wrapper that asks for a reason from one that does not.
 * An array answers the same command (or buffer read) differently on each
 * call, in order, the way a file rewritten between two reads does.
 */
export function stubCtx(
  responses: Record<string, string | string[]>,
  errorString: string | string[] = "",
): { ctx: CallContext; sent: string[]; reads: () => number } {
  const sent: string[] = [];
  let reads = 0;
  const ctx: CallContext = {
    async call(cmd) {
      sent.push(cmd);
      const entry = responses[cmd];
      const response = Array.isArray(entry) ? entry.shift() : entry;
      if (response === undefined) {
        throw new Error(`stubCtx: no response configured for "${cmd}"`);
      }
      return response;
    },
    async getErrorString() {
      reads += 1;
      return {
        errorString: Array.isArray(errorString)
          ? (errorString.shift() ?? "")
          : errorString,
      };
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

describe("readSimulationResult: a file rewritten between the size read and the read", () => {
  it("retries once at the new row count when the file grew", async () => {
    const { ctx, sent } = stubCtx(
      {
        'readSimulationResultSize("run.mat")': ["2", "3"],
        'readSimulationResult("run.mat", {time}, 2)': "fail()",
        'readSimulationResult("run.mat", {time}, 3)': "{{0.0, 0.5, 1.0}}",
      },
      "Error: size mismatch",
    );

    const out = await readSimulationResult(ctx, {
      filename: "run.mat",
      variables: ["time"],
    });

    expect(out.result).toEqual([[0.0, 0.5, 1.0]]);
    expect(sent).toEqual([
      'readSimulationResultSize("run.mat")',
      'readSimulationResult("run.mat", {time}, 2)',
      'readSimulationResultSize("run.mat")',
      'readSimulationResult("run.mat", {time}, 3)',
    ]);
  });

  it("answers one empty row per variable when the file was rewritten empty", async () => {
    const { ctx, sent } = stubCtx(
      {
        'readSimulationResultSize("run.mat")': ["2", "0"],
        'readSimulationResult("run.mat", {time, x}, 2)': "fail()",
      },
      "Error: size mismatch",
    );

    const out = await readSimulationResult(ctx, {
      filename: "run.mat",
      variables: ["time", "x"],
    });

    expect(out.result).toEqual([[], []]);
    expect(sent).toEqual([
      'readSimulationResultSize("run.mat")',
      'readSimulationResult("run.mat", {time, x}, 2)',
      'readSimulationResultSize("run.mat")',
    ]);
  });

  it("raises the original failure, without a second read, when the row count held", async () => {
    const { ctx, sent } = stubCtx(
      {
        'readSimulationResultSize("run.mat")': ["2", "2"],
        'readSimulationResult("run.mat", {nope}, 2)': "fail()",
      },
      ['Error: variable "nope" not found', "Error: a later reason"],
    );

    await expect(
      readSimulationResult(ctx, { filename: "run.mat", variables: ["nope"] }),
    ).rejects.toThrow(
      new OmcDiagnosticError(
        'readSimulationResult: Error: variable "nope" not found',
      ),
    );
    expect(
      sent.filter((c) => c.startsWith("readSimulationResult(")),
    ).toHaveLength(1);
  });

  it("retries at most once", async () => {
    const { ctx, sent } = stubCtx(
      {
        'readSimulationResultSize("run.mat")': ["2", "3", "4"],
        'readSimulationResult("run.mat", {time}, 2)': "fail()",
        'readSimulationResult("run.mat", {time}, 3)': "fail()",
      },
      ["Error: size mismatch at 2", "Error: size mismatch at 3"],
    );

    await expect(
      readSimulationResult(ctx, { filename: "run.mat", variables: ["time"] }),
    ).rejects.toThrow(
      new OmcDiagnosticError("readSimulationResult: Error: size mismatch at 3"),
    );
    expect(sent).toEqual([
      'readSimulationResultSize("run.mat")',
      'readSimulationResult("run.mat", {time}, 2)',
      'readSimulationResultSize("run.mat")',
      'readSimulationResult("run.mat", {time}, 3)',
    ]);
  });

  it("keeps the read's own failure when the file can no longer be sized", async () => {
    const { ctx, sent } = stubCtx(
      {
        'readSimulationResultSize("run.mat")': ["2", "-1"],
        'readSimulationResult("run.mat", {time}, 2)': "fail()",
      },
      ["Error: size mismatch", "Error: Failed to open run.mat"],
    );

    await expect(
      readSimulationResult(ctx, { filename: "run.mat", variables: ["time"] }),
    ).rejects.toThrow(
      new OmcDiagnosticError("readSimulationResult: Error: size mismatch"),
    );
    expect(sent).toEqual([
      'readSimulationResultSize("run.mat")',
      'readSimulationResult("run.mat", {time}, 2)',
      'readSimulationResultSize("run.mat")',
    ]);
  });

  it("never retries a caller-supplied size", async () => {
    const { ctx, sent } = stubCtx(
      { 'readSimulationResult("run.mat", {time}, 2)': "fail()" },
      "Error: size mismatch",
    );

    await expect(
      readSimulationResult(ctx, {
        filename: "run.mat",
        variables: ["time"],
        size: 2,
      }),
    ).rejects.toThrow(OmcDiagnosticError);
    expect(sent).toEqual(['readSimulationResult("run.mat", {time}, 2)']);
  });
});
