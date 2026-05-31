/**
 * OMC: `function filterSimulationResults`
 *
 * ```modelica
 * function filterSimulationResults
 *   input String inFile;
 *   input String outFile;
 *   input String[:] vars;
 *   input Integer numberOfIntervals = 0 "0=Do not resample";
 *   input Boolean removeDescription = false;
 *   input Boolean hintReadAllVars = true;
 *   output Boolean success;
 * end filterSimulationResults;
 * ```
 *
 * Writes a new result file containing only the named `vars`. Useful as a
 * postprocessing step to ship a tiny derived `.mat` over the wire instead
 * of the multi-MB raw simulation output.
 *
 * `numberOfIntervals > 0` resamples the data to that many intervals
 * (event points are discarded). `hintReadAllVars=true` loads the entire
 * input file into memory in one pass — faster but can OOM on huge files.
 */

import { z } from "zod";

import type { CallContext } from "../../_shared/callContext.js";
import { mlBool, quote, quoteList } from "../../_shared/format.js";
import { SuccessOutput } from "../../_shared/outputs.js";
import { parseOutput } from "../../_shared/parseOutput.js";
import { expectBool, parse } from "../../parse.js";

export const FilterSimulationResultsInputSchema = z.object({
  inFile: z.string().describe("Source simulation result file."),
  outFile: z
    .string()
    .describe("Destination path for the filtered result file."),
  vars: z
    .array(z.string())
    .describe(
      "Variable names to keep in the output file (dotted paths). `time` is always retained.",
    ),
  numberOfIntervals: z
    .number()
    .int()
    .optional()
    .default(0)
    .describe(
      "If non-zero, resample the data to this many intervals (event points discarded). 0 keeps original sampling.",
    ),
  removeDescription: z
    .boolean()
    .optional()
    .default(false)
    .describe(
      "Replace per-variable description strings with empty strings to shrink the output.",
    ),
  hintReadAllVars: z
    .boolean()
    .optional()
    .default(true)
    .describe(
      "Load the entire input file into memory at once (faster; risks OOM on very large files).",
    ),
});
export type FilterSimulationResultsInput = z.input<
  typeof FilterSimulationResultsInputSchema
>;

export const FilterSimulationResultsOutputSchema = SuccessOutput;
export type FilterSimulationResultsOutput = z.infer<
  typeof FilterSimulationResultsOutputSchema
>;

export const FilterSimulationResultsDescription =
  "Write a new simulation result file containing only the named variables (with optional resampling and description stripping).";

export async function filterSimulationResults(
  ctx: CallContext,
  input: FilterSimulationResultsInput,
): Promise<FilterSimulationResultsOutput> {
  const raw = await ctx.call(
    `filterSimulationResults(${quote(input.inFile)}, ${quote(input.outFile)}, ${quoteList(input.vars)}, ${input.numberOfIntervals ?? 0}, ${mlBool(input.removeDescription ?? false)}, ${mlBool(input.hintReadAllVars ?? true)})`,
  );
  return parseOutput(
    FilterSimulationResultsOutputSchema,
    { success: expectBool(parse(raw)) },
    "filterSimulationResults",
  );
}
