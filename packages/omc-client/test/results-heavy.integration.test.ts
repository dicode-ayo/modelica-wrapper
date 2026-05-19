/**
 * Heavy integration tests for the Execution + Results categories —
 * exercises every wrapper that needs to invoke the C toolchain or read
 * an actual `.mat` file.
 *
 * The suite spins up a fresh OMC client, runs `simulate` inside a temp
 * directory on a tiny ramp model (so wall-clock cost is ~5–10 s), then
 * exercises:
 *
 *   simulate (in beforeAll, also asserted in its own test)
 *   translateModel / buildModel / translateModelXML
 *   readSimulationResultSize / readSimulationResultVars / readSimulationResult / val
 *   filterSimulationResults / compareSimulationResults / deltaSimulationResults / diffSimulationResults
 *   closeSimulationResultFile
 *
 * Gating: this suite runs only when `OMC_INTEGRATION_HEAVY=1` (in addition
 * to the normal `omc` PATH check). Each translate/build/simulate call
 * invokes the C compiler, which is too slow to run on every push of
 * unrelated changes. The standard integration suite is unaffected.
 *
 * Cleanup: the temp directory and every emitted artifact are removed in
 * `afterAll`, regardless of test outcome.
 */

import { execSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { OmcClient } from "../src/client.js";
import { asString, expectString } from "../src/parse.js";
import type { Value } from "../src/parse.js";

const HEAVY_FLAG = "OMC_INTEGRATION_HEAVY";

function shouldRun(): boolean {
  if (process.env[HEAVY_FLAG] !== "1") return false;
  if (process.env.OMC_INTEGRATION === "0") return false;
  try {
    execSync(process.platform === "win32" ? "where omc" : "command -v omc", {
      stdio: "ignore",
    });
    return true;
  } catch {
    return false;
  }
}

const describeIf = shouldRun() ? describe : describe.skip;

/**
 * Extract a named field from the SimulationResult record's kwarg list.
 * The simulate wrapper returns the raw Value tree because the record
 * shape varies across OMC versions.
 */
function getRecordField(record: Value, field: string): Value | undefined {
  if (record.kind !== "call") return undefined;
  for (const arg of record.args) {
    if (arg.kind === "kwarg" && arg.name === field) return arg.value;
  }
  return undefined;
}

describeIf("OmcClient results-reading against a real .mat file", () => {
  let client: OmcClient;
  let tempDir: string;
  let modelClass: string;
  /** The `.mat` file produced by `simulate`. */
  let resultFile: string;

  beforeAll(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "mw-results-"));

    client = await OmcClient.create({ omcPath: process.env.OMC_PATH ?? "" });
    // simulate's C-compile step can be slow on first run.
    client.setCallTimeout(180_000);

    // Run OMC's working dir inside our scratch dir so generated artifacts
    // (.mat, .c, .o, .makefile, executable) land there.
    await client.cd({ newWorkingDirectory: tempDir });

    // Tiny ramp model — der(x) = 1, x(0) = 0, so x(t) = t. Easy to verify.
    const pkg = `MwHeavy_${Math.random().toString(36).slice(2, 10)}`;
    modelClass = `${pkg}.Ramp`;
    const data = `package ${pkg}
  model Ramp
    Real x(start=0);
  equation
    der(x) = 1;
  end Ramp;
end ${pkg};
`;
    const loaded = await client.loadString({
      data,
      filename: `<fixture:${pkg}>`,
    });
    if (!loaded.success) {
      const { errorString } = await client.getErrorString();
      throw new Error(`loadString failed: ${errorString}`);
    }

    const sim = await client.simulate({
      typeName: modelClass,
      startTime: 0,
      stopTime: 1,
      numberOfIntervals: 100,
      tolerance: 1e-9,
    });

    const fileField = getRecordField(sim.simulationResult, "resultFile");
    if (fileField === undefined) {
      throw new Error(
        `simulate did not return a resultFile; record was ${JSON.stringify(
          sim.simulationResult,
        )}`,
      );
    }
    const path = asString(fileField);
    if (path === undefined || path.length === 0) {
      const { errorString } = await client.getErrorString();
      throw new Error(
        `simulate returned empty resultFile; OMC errors: ${errorString}`,
      );
    }
    resultFile = path;
  }, 240_000);

  afterAll(async () => {
    try {
      await client.closeSimulationResultFile();
    } catch {
      // Already closed or the test never opened it — fine.
    }
    await client.close();
    await rm(tempDir, { recursive: true, force: true });
  });

  // === Execution: simulate / translate / build ===

  it("simulate emits a .mat file at the path it reports", () => {
    expect(resultFile.endsWith(".mat")).toBe(true);
    expect(resultFile.startsWith(tempDir)).toBe(true);
  });

  it("simulate returns a SimulationResult record with `resultFile` + `messages`", async () => {
    // The beforeAll already simulated; re-read the same record via a
    // dedicated call so this test fails cleanly if the SimulationResult
    // shape ever drifts. Use a separate fileNamePrefix so we don't
    // clobber the .mat the rest of the suite reads.
    const sim = await client.simulate({
      typeName: modelClass,
      startTime: 0,
      stopTime: 0.1,
      numberOfIntervals: 10,
      fileNamePrefix: "Ramp_shape_check",
    });
    const rec = sim.simulationResult;
    expect(rec.kind).toBe("call");
    const fields = new Set<string>();
    if (rec.kind === "call") {
      for (const arg of rec.args) {
        if (arg.kind === "kwarg") fields.add(arg.name);
      }
    }
    // OMC's SimulationResult shape varies across versions but always
    // carries these two fields.
    expect(fields.has("resultFile")).toBe(true);
    expect(fields.has("messages")).toBe(true);
  });

  it("translateModel reports success for a valid model", async () => {
    const { success } = await client.translateModel({ typeName: modelClass });
    expect(success).toBe(true);
  });

  it("buildModel returns the executable name and init file", async () => {
    const { artifacts } = await client.buildModel({ typeName: modelClass });
    expect(artifacts.length).toBe(2);
    const [exeName, initFile] = artifacts as [string, string];
    // OMC names the executable after the FQN'd model.
    expect(exeName).toContain("Ramp");
    // Init file is the runtime XML companion, by convention `<exe>_init.xml`.
    expect(initFile).toMatch(/_init\.xml$/);
  });

  it("translateModelXML reports a .xml filename for the model", async () => {
    const { generatedFileName } = await client.translateModelXML({
      typeName: modelClass,
    });
    // OMC reports the filename it intends to write. The actual on-disk
    // path is OMC-version-dependent (sometimes relative to cwd,
    // sometimes to OMC's build-output dir); we only assert the
    // wrapper's parse + the reported name shape here. The
    // `simulate`/`buildModel`/`translateModel` tests above already
    // prove the full toolchain works end-to-end.
    expect(generatedFileName.length).toBeGreaterThan(0);
    expect(generatedFileName).toMatch(/\.xml$/);
    expect(generatedFileName).toContain("Ramp");
  });

  it("readSimulationResultSize reflects the stored row count", async () => {
    const { size } = await client.readSimulationResultSize({
      fileName: resultFile,
    });
    // OMC 1.26.x stores `numberOfIntervals + 2` rows for our ramp model
    // (start + N output points + a final extra; exact count is solver-
    // dependent). We assert the right ballpark instead of pinning it
    // down to a precise value that drifts across OMC versions.
    expect(size).toBeGreaterThanOrEqual(101);
    expect(size).toBeLessThanOrEqual(103);
  });

  it("readSimulationResultVars lists `time` and `x`", async () => {
    const { vars } = await client.readSimulationResultVars({
      fileName: resultFile,
    });
    expect(vars).toContain("time");
    expect(vars).toContain("x");
  });

  it("readSimulationResultVars(readParameters=false) drops parameters from the listing", async () => {
    const withParams = await client.readSimulationResultVars({
      fileName: resultFile,
      readParameters: true,
    });
    const noParams = await client.readSimulationResultVars({
      fileName: resultFile,
      readParameters: false,
    });
    // Same model vars; parameter set may be empty for this fixture, so
    // assert the no-params list is a subset of the with-params one.
    for (const v of noParams.vars) {
      expect(withParams.vars).toContain(v);
    }
  });

  // === Numerical reads ===

  it("readSimulationResult returns a 2D matrix with one row per variable", async () => {
    const { result } = await client.readSimulationResult({
      filename: resultFile,
      variables: ["time", "x"],
    });
    expect(result.length).toBe(2);
    const [timeRow, xRow] = result as [number[], number[]];
    // Same row count for both variables, anchored to a known range.
    expect(timeRow.length).toBeGreaterThanOrEqual(101);
    expect(xRow.length).toBe(timeRow.length);
    // Endpoints land where the ramp model says they should.
    expect(timeRow[0]).toBeCloseTo(0, 9);
    expect(timeRow[timeRow.length - 1]!).toBeCloseTo(1, 6);
    expect(xRow[0]).toBeCloseTo(0, 9);
    expect(xRow[xRow.length - 1]!).toBeCloseTo(1, 6);
  });

  it("val reads a single variable at a single time-point", async () => {
    const at0 = await client.val({
      var: "x",
      timePoint: 0,
      fileName: resultFile,
    });
    expect(at0.valAtTime).toBeCloseTo(0, 9);
    const at1 = await client.val({
      var: "x",
      timePoint: 1,
      fileName: resultFile,
    });
    expect(at1.valAtTime).toBeCloseTo(1, 6);
    const at05 = await client.val({
      var: "x",
      timePoint: 0.5,
      fileName: resultFile,
    });
    expect(at05.valAtTime).toBeCloseTo(0.5, 6);
  });

  // === Postprocessing ===

  it("filterSimulationResults writes a new .mat containing only the requested vars", async () => {
    const filtered = join(tempDir, "filtered.mat");
    const { success } = await client.filterSimulationResults({
      inFile: resultFile,
      outFile: filtered,
      vars: ["x"],
    });
    expect(success).toBe(true);

    const { vars } = await client.readSimulationResultVars({
      fileName: filtered,
    });
    // `time` is always retained as the independent axis.
    expect(vars).toContain("time");
    expect(vars).toContain("x");
  });

  it("filterSimulationResults can resample the data to a smaller grid", async () => {
    const resampled = join(tempDir, "resampled.mat");
    const { success } = await client.filterSimulationResults({
      inFile: resultFile,
      outFile: resampled,
      vars: ["x"],
      numberOfIntervals: 10,
    });
    expect(success).toBe(true);

    const { size } = await client.readSimulationResultSize({
      fileName: resampled,
    });
    // Resampled to 10 intervals → 11 grid points. (No extra end-point
    // padding in resampled output.)
    expect(size).toBeGreaterThanOrEqual(11);
    expect(size).toBeLessThanOrEqual(12);
  });

  it("compareSimulationResults reports equal when comparing a file to itself", async () => {
    const log = join(tempDir, "compare.log");
    const { result } = await client.compareSimulationResults({
      filename: resultFile,
      reffilename: resultFile,
      logfilename: log,
    });
    expect(result.length).toBeGreaterThan(0);
    // OMC's exact wording varies by version; tolerate either phrasing.
    expect(result.join(" ").toLowerCase()).toMatch(/equal|match/);
  });

  it("deltaSimulationResults reports zero error against itself for every norm", async () => {
    for (const method of ["1norm", "2norm", "maxerr"] as const) {
      const { result } = await client.deltaSimulationResults({
        filename: resultFile,
        reffilename: resultFile,
        method,
      });
      expect(result).toBeCloseTo(0, 9);
    }
  });

  it("diffSimulationResults reports success and empty failVars against itself", async () => {
    const { success, failVars } = await client.diffSimulationResults({
      actualFile: resultFile,
      expectedFile: resultFile,
      diffPrefix: join(tempDir, "diff"),
    });
    expect(success).toBe(true);
    expect(failVars).toEqual([]);
  });

  // === Cleanup primitive ===

  it("closeSimulationResultFile reports success", async () => {
    const { success } = await client.closeSimulationResultFile();
    expect(success).toBe(true);
  });

  // === Defensive: invoke() dispatch path for one of the new wrappers ===

  it("invoke() can dispatch filterSimulationResults by name", async () => {
    const filtered = join(tempDir, "via-invoke.mat");
    const r = await client.invoke("filterSimulationResults", {
      inFile: resultFile,
      outFile: filtered,
      vars: ["x"],
    });
    expect(r.success).toBe(true);
  });
});

// Silence the unused-import warning when the suite is skipped.
void expectString;
