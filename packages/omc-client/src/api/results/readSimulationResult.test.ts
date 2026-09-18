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
      const response = responses[cmd];
      if (response === undefined) {
        throw new Error(`stubCtx: no response configured for "${cmd}"`);
      }
      return response;
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
