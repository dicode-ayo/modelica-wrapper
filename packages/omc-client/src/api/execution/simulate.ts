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
  typeName: z.string(),
  startTime: z.number().optional(),
  stopTime: z.number().optional().default(1.0),
  numberOfIntervals: z.number().int().optional().default(500),
  tolerance: z.number().optional().default(1e-6),
  method: z.string().optional().default("<default>"),
  fileNamePrefix: z.string().optional().default("<default>"),
  options: z.string().optional().default("<default>"),
  outputFormat: z.string().optional().default("mat"),
  variableFilter: z.string().optional().default(".*"),
  cflags: z.string().optional().default("<default>"),
  simflags: z.string().optional().default("<default>"),
});
export type SimulateInput = z.input<typeof SimulateInputSchema>;

/**
 * The raw SimulationResult record as a Value tree (record fields preserved as
 * a CallV with named-parameter args). Downstream code can interpret per the
 * OMC version it's running against.
 */
export const SimulateOutputSchema = z.object({
  /** The raw OMC SimulationResult record value. */
  simulationResult: ValueSchema,
});
export type SimulateOutput = z.infer<typeof SimulateOutputSchema>;

export async function simulate(
  ctx: CallContext,
  input: SimulateInput,
): Promise<SimulateOutput> {
  const startTime =
    input.startTime === undefined ? `"<default>"` : String(input.startTime);
  const raw = await ctx.call(
    `simulate(${input.typeName}, startTime=${startTime}, stopTime=${input.stopTime ?? 1.0}, numberOfIntervals=${input.numberOfIntervals ?? 500}, tolerance=${input.tolerance ?? 1e-6}, method=${quote(input.method ?? "<default>")}, fileNamePrefix=${quote(input.fileNamePrefix ?? "<default>")}, options=${quote(input.options ?? "<default>")}, outputFormat=${quote(input.outputFormat ?? "mat")}, variableFilter=${quote(input.variableFilter ?? ".*")}, cflags=${quote(input.cflags ?? "<default>")}, simflags=${quote(input.simflags ?? "<default>")})`,
  );
  return parseOutput(
    SimulateOutputSchema,
    { simulationResult: parse(raw) },
    "simulate",
  );
}
