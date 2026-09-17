/**
 * `readSimulationResult`'s documented `size = 0` ("reads any size") silently
 * returns an empty matrix on some result formats instead of the actual
 * rows (#699). A `size` of 0 (or omitted) is resolved via
 * `readSimulationResultSize` first, so the OMC-side `size = 0` bug is never
 * reached.
 */

import { describe, expect, it } from "vitest";

import type { CallContext } from "../../_shared/callContext.js";

import { readSimulationResult } from "./readSimulationResult.js";

function stubCtx(responses: Record<string, string>): {
  ctx: CallContext;
  sent: string[];
} {
  const sent: string[] = [];
  const ctx: CallContext = {
    async call(cmd) {
      sent.push(cmd);
      for (const [prefix, response] of Object.entries(responses)) {
        if (cmd.startsWith(prefix)) return response;
      }
      throw new Error(`stubCtx: no response configured for "${cmd}"`);
    },
    async getErrorString() {
      return { errorString: "" };
    },
  };
  return { ctx, sent };
}

describe("readSimulationResult: size = 0 resolution", () => {
  it("resolves size via readSimulationResultSize instead of passing 0 through", async () => {
    const { ctx, sent } = stubCtx({
      'readSimulationResultSize("run.csv")': "12",
      "readSimulationResult(": "{{0.0, 0.1}, {1.0, 0.9}}",
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
      "readSimulationResult(": "{{0.0, 0.1}, {1.0, 0.9}}",
    });

    await readSimulationResult(ctx, {
      filename: "run.mat",
      variables: ["time", "x"],
      size: 12,
    });

    expect(sent).toEqual(['readSimulationResult("run.mat", {time, x}, 12)']);
  });

  it("returns an empty matrix, not an error, when the file genuinely has 0 rows", async () => {
    const { ctx, sent } = stubCtx({
      'readSimulationResultSize("empty.csv")': "0",
      "readSimulationResult(": "{}",
    });

    const out = await readSimulationResult(ctx, {
      filename: "empty.csv",
      variables: ["time"],
    });

    expect(out.result).toEqual([]);
    expect(sent).toEqual([
      'readSimulationResultSize("empty.csv")',
      'readSimulationResult("empty.csv", {time}, 0)',
    ]);
  });
});
