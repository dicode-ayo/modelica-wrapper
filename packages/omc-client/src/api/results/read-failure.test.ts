/**
 * OMC signals a failed result read in the value it hands back — `fail()`, a
 * `-1` row count, an empty variable list — and puts the reason in its error
 * buffer. These pin that each of the three wrappers reaches for that reason
 * rather than reporting the shape it could not parse.
 */

import { describe, expect, it } from "vitest";

import type { CallContext } from "../../_shared/callContext.js";

import { readSimulationResult } from "./readSimulationResult.js";
import { readSimulationResultSize } from "./readSimulationResultSize.js";
import { readSimulationResultVars } from "./readSimulationResultVars.js";

const MISSING_FILE =
  "Error: Failed to open simulation result gone.mat: No such file or directory\n";

function stubCtx(
  responses: Record<string, string>,
  errorString = "",
): { ctx: CallContext; reads: () => number } {
  let reads = 0;
  const ctx: CallContext = {
    async call(cmd) {
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
  return { ctx, reads: () => reads };
}

describe("a read OMC could not perform reports OMC's reason", () => {
  it("raises the buffered reason for an empty variable list (#720)", async () => {
    const { ctx } = stubCtx(
      {
        'readSimulationResultVars("gone.mat", readParameters=true, openmodelicaStyle=false)':
          "{}",
      },
      MISSING_FILE,
    );

    await expect(
      readSimulationResultVars(ctx, { fileName: "gone.mat" }),
    ).rejects.toThrow(/Failed to open simulation result gone\.mat/);
  });

  it("lets a genuinely variable-free result stay a success", async () => {
    const stub = stubCtx({
      'readSimulationResultVars("empty.mat", readParameters=true, openmodelicaStyle=false)':
        "{}",
    });

    const out = await readSimulationResultVars(stub.ctx, {
      fileName: "empty.mat",
    });

    expect(out.vars).toEqual([]);
  });

  it("does not spend a buffer read on a result that named its variables", async () => {
    const stub = stubCtx({
      'readSimulationResultVars("run.mat", readParameters=true, openmodelicaStyle=false)':
        '{"time", "x"}',
    });

    await readSimulationResultVars(stub.ctx, { fileName: "run.mat" });

    expect(stub.reads()).toBe(0);
  });

  it("raises the buffered reason for a -1 row count rather than a shape mismatch", async () => {
    const { ctx } = stubCtx(
      { 'readSimulationResultSize("gone.mat")': "-1" },
      MISSING_FILE,
    );

    await expect(
      readSimulationResultSize(ctx, { fileName: "gone.mat" }),
    ).rejects.toThrow(/Failed to open simulation result gone\.mat/);
  });

  it("still fails when OMC answers -1 with nothing in the buffer", async () => {
    const { ctx } = stubCtx({ 'readSimulationResultSize("gone.mat")': "-1" });

    await expect(
      readSimulationResultSize(ctx, { fileName: "gone.mat" }),
    ).rejects.toThrow(/readSimulationResultSize/);
  });

  it("raises the buffered reason for a fail(), which a size and a variable share (#681)", async () => {
    const { ctx } = stubCtx(
      { 'readSimulationResult("run.mat", {nosuchvar}, 12)': "fail()" },
      "Error: Could not read variable nosuchvar in file run.mat.\n",
    );

    // The same `fail()` answers a mismatched `size`, so the message has to
    // come from OMC rather than name an argument the wrapper guessed at.
    await expect(
      readSimulationResult(ctx, {
        filename: "run.mat",
        variables: ["nosuchvar"],
        size: 12,
      }),
    ).rejects.toThrow(/Could not read variable nosuchvar/);
  });

  it("reports a missing file through the size resolution it makes first", async () => {
    const { ctx } = stubCtx(
      { 'readSimulationResultSize("gone.mat")': "-1" },
      MISSING_FILE,
    );

    await expect(
      readSimulationResult(ctx, { filename: "gone.mat", variables: ["x"] }),
    ).rejects.toThrow(/Failed to open simulation result gone\.mat/);
  });

  it("treats a warning left in the buffer as no reason at all", async () => {
    const stub = stubCtx(
      {
        'readSimulationResultVars("empty.mat", readParameters=true, openmodelicaStyle=false)':
          "{}",
      },
      "Warning: The initial conditions are not fully specified.\n",
    );

    const out = await readSimulationResultVars(stub.ctx, {
      fileName: "empty.mat",
    });

    expect(out.vars).toEqual([]);
  });
});
