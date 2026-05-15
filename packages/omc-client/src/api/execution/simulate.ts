/**
 * OMC: `function simulate`
 *
 * Run translate + build + run synchronously. The full set of input args
 * matches OMC's docs exactly:
 *
 * ```modelica
 * function simulate
 *   input TypeName className;
 *   input Real startTime = "<default>";
 *   input Real stopTime = 1.0;
 *   input Integer numberOfIntervals = 500;
 *   input Real tolerance = 1e-6;
 *   input String method = "<default>";
 *   input String fileNamePrefix = "<default>";
 *   input String options = "<default>";
 *   input String outputFormat = "mat";
 *   input String variableFilter = ".*";
 *   input String cflags = "<default>";
 *   input String simflags = "<default>";
 *   output SimulationResult simulationResults;
 * end simulate;
 * ```
 *
 * NOTE: streaming progress is not yet implemented. The call blocks until
 * OMC's simulate() returns. For long runs, raise the call timeout via
 * `OmcClient.setCallTimeout`.
 *
 * The OMC `SimulationResult` is a record. We surface its fields as a
 * loosely-typed object — exact field set varies across OMC versions; what
 * we know is consistently present is `resultFile` and `messages`.
 */

import { z } from "zod";

import type { CallContext } from "../../_shared/callContext.js";
import { quote } from "../../_shared/format.js";
import { parseOutput } from "../../_shared/parseOutput.js";
import { ValueSchema } from "../../_shared/value.js";
import { parse } from "../../parse.js";

export const SimulateInputSchema = z.object({
  typeName: z.string().describe("Class to simulate."),
  startTime: z.number().optional().describe("Simulation start time; omit to fall back to OMC's `<default>` (i.e. the experiment annotation)."),
  stopTime: z.number().optional().default(1.0).describe("Simulation stop time."),
  numberOfIntervals: z.number().int().optional().default(500).describe("Number of output intervals."),
  tolerance: z.number().optional().default(1e-6).describe("Solver tolerance."),
  method: z.string().optional().default("<default>").describe('Solver method name; "<default>" lets OMC pick.'),
  fileNamePrefix: z.string().optional().default("<default>").describe('Prefix for generated artifact filenames; "<default>" lets OMC pick.'),
  options: z.string().optional().default("<default>").describe('Extra OMC simulate-time options; "<default>" leaves them unset.'),
  outputFormat: z.string().optional().default("mat").describe('Result file format ("mat", "csv", "plt", …).'),
  variableFilter: z.string().optional().default(".*").describe("Regex selecting which variables get stored in the result file."),
  cflags: z.string().optional().default("<default>").describe('Extra C compiler flags; "<default>" leaves them unset.'),
  simflags: z.string().optional().default("<default>").describe('Extra runtime simulator flags; "<default>" leaves them unset.'),
});
export type SimulateInput = z.input<typeof SimulateInputSchema>;

/**
 * The raw SimulationResult record as a Value tree (record fields preserved as
 * a CallV with named-parameter args). Downstream code can interpret per the
 * OMC version it's running against.
 */
export const SimulateOutputSchema = z.object({
  /** The raw OMC SimulationResult record value. */
  simulationResult: ValueSchema.describe("Raw OMC `SimulationResult` record as a parsed Value tree (field set varies by OMC version)."),
});
export type SimulateOutput = z.infer<typeof SimulateOutputSchema>;

export const SimulateDescription =
  "Simulate a Modelica model: generate C code, build the simulation executable, and run it; returns the raw OMC SimulationResult record.";

export async function simulate(
  ctx: CallContext,
  input: SimulateInput,
): Promise<SimulateOutput> {
  // Build the named-argument list piecewise, omitting any parameter the
  // caller didn't set OR explicitly set to the literal `"<default>"`.
  //
  // Why this matters: OMC's `simulate` declares every string parameter
  // with the default value `"<default>"`. When OMC sees that exact
  // string on the call site it substitutes whatever it considers a
  // sane default at runtime. But for `fileNamePrefix` / `cflags` /
  // `simflags` / `options`, OMC currently treats the literal `<default>`
  // as a real string — splat into filenames and compiler flags, which
  // then crashes `/bin/sh` at compile time (the `<` / `>` are parsed as
  // redirection operators). The matching `val.ts` wrapper uses the same
  // omit-when-default idiom for the same reason.
  const parts: string[] = [input.typeName];
  const num = (name: string, v: number | undefined): void => {
    if (v !== undefined) parts.push(`${name}=${v}`);
  };
  const str = (name: string, v: string | undefined): void => {
    if (v !== undefined && v !== "<default>") {
      parts.push(`${name}=${quote(v)}`);
    }
  };
  num("startTime", input.startTime);
  num("stopTime", input.stopTime);
  num("numberOfIntervals", input.numberOfIntervals);
  num("tolerance", input.tolerance);
  str("method", input.method);
  str("fileNamePrefix", input.fileNamePrefix);
  str("options", input.options);
  str("outputFormat", input.outputFormat);
  str("variableFilter", input.variableFilter);
  str("cflags", input.cflags);
  str("simflags", input.simflags);
  const raw = await ctx.call(`simulate(${parts.join(", ")})`);
  return parseOutput(
    SimulateOutputSchema,
    { simulationResult: parse(raw) },
    "simulate",
  );
}
