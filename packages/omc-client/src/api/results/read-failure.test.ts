/**
 * OMC signals a failed result read in the value it hands back — `fail()`, a
 * `-1` row count, an empty variable list — and puts the reason in its error
 * buffer. These pin that each of the three wrappers reaches for that reason
 * rather than reporting the shape it could not parse, and that it throws the
 * type the MCP dispatcher keeps between the model and the tool.
 */

import { describe, expect, it } from "vitest";

import { NO_REASON } from "../../_shared/parseOutput.js";
import { OmcDiagnosticError } from "../../error-buffer.js";

import { readSimulationResult } from "./readSimulationResult.js";
import { stubCtx } from "./readSimulationResult.test.js";
import { readSimulationResultSize } from "./readSimulationResultSize.js";
import { readSimulationResultVars } from "./readSimulationResultVars.js";

const MISSING_FILE =
  "Error: Failed to open simulation result gone.mat: No such file or directory\n";

const VARS_GONE =
  'readSimulationResultVars("gone.mat", readParameters=true, openmodelicaStyle=false)';
const VARS_EMPTY =
  'readSimulationResultVars("empty.mat", readParameters=true, openmodelicaStyle=false)';

describe("a read OMC could not perform reports OMC's reason", () => {
  it("raises the buffered reason for an empty variable list (#720)", async () => {
    const { ctx } = stubCtx({ [VARS_GONE]: "{}" }, MISSING_FILE);

    await expect(
      readSimulationResultVars(ctx, { fileName: "gone.mat" }),
    ).rejects.toThrow(/Failed to open simulation result gone\.mat/);
    // `dispatchByName` keeps a failed read out of a toast by its error's type.
    await expect(
      readSimulationResultVars(ctx, { fileName: "gone.mat" }),
    ).rejects.toThrow(OmcDiagnosticError);
  });

  it("raises the buffered reason for a -1 row count rather than a shape mismatch", async () => {
    const { ctx } = stubCtx(
      { 'readSimulationResultSize("gone.mat")': "-1" },
      MISSING_FILE,
    );

    await expect(
      readSimulationResultSize(ctx, { fileName: "gone.mat" }),
    ).rejects.toThrow(/Failed to open simulation result gone\.mat/);
    await expect(
      readSimulationResultSize(ctx, { fileName: "gone.mat" }),
    ).rejects.toThrow(OmcDiagnosticError);
  });

  it("raises the buffered reason for a fail(), which a size and a variable share (#681)", async () => {
    const { ctx } = stubCtx(
      { 'readSimulationResult("run.mat", {nosuchvar}, 12)': "fail()" },
      "Error: Could not read variable nosuchvar in file run.mat.\n",
    );

    await expect(
      readSimulationResult(ctx, {
        filename: "run.mat",
        variables: ["nosuchvar"],
        size: 12,
      }),
    ).rejects.toThrow(/Could not read variable nosuchvar/);
    await expect(
      readSimulationResult(ctx, {
        filename: "run.mat",
        variables: ["nosuchvar"],
        size: 12,
      }),
    ).rejects.toThrow(OmcDiagnosticError);
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

  it("still fails, saying so, when OMC answers -1 with nothing in the buffer", async () => {
    const { ctx } = stubCtx({ 'readSimulationResultSize("gone.mat")': "-1" });

    await expect(
      readSimulationResultSize(ctx, { fileName: "gone.mat" }),
    ).rejects.toThrow(`readSimulationResultSize: ${NO_REASON}`);
  });

  it("still fails, saying so, when OMC answers fail() with nothing in the buffer", async () => {
    const { ctx } = stubCtx({
      'readSimulationResult("run.mat", {x}, 12)': "fail()",
    });

    await expect(
      readSimulationResult(ctx, {
        filename: "run.mat",
        variables: ["x"],
        size: 12,
      }),
    ).rejects.toThrow(`readSimulationResult: ${NO_REASON}`);
  });
});

describe("a read OMC performed stays a success", () => {
  it("lets a genuinely variable-free result through", async () => {
    const { ctx } = stubCtx({ [VARS_EMPTY]: "{}" });

    expect(
      (await readSimulationResultVars(ctx, { fileName: "empty.mat" })).vars,
    ).toEqual([]);
  });

  it("treats a warning left in the buffer as no reason at all", async () => {
    const { ctx } = stubCtx(
      { [VARS_EMPTY]: "{}" },
      "Warning: The initial conditions are not fully specified.\n",
    );

    expect(
      (await readSimulationResultVars(ctx, { fileName: "empty.mat" })).vars,
    ).toEqual([]);
  });

  it("does not spend a buffer read on a result that named its variables", async () => {
    const stub = stubCtx({
      'readSimulationResultVars("run.mat", readParameters=true, openmodelicaStyle=false)':
        '{"time", "x"}',
    });

    await readSimulationResultVars(stub.ctx, { fileName: "run.mat" });

    expect(stub.reads()).toBe(0);
  });
});
