/**
 * OMC: `function deltaSimulationResults`
 *
 * ```modelica
 * function deltaSimulationResults
 *   input String filename;
 *   input String reffilename;
 *   input String method "method to compute the error. choose 1norm, 2norm, maxerr";
 *   input String[:] vars = fill("", 0);
 *   output Real result;
 * end deltaSimulationResults;
 * ```
 *
 * Aggregates the per-time-point absolute error between two result files
 * into a single scalar using one of three norms:
 *  - `"1norm"`  — sum of absolute errors
 *  - `"2norm"`  — Euclidean norm of the error
 *  - `"maxerr"` — maximum absolute error
 *
 * Empty `vars` aggregates across every variable found in `filename`.
 */

import { z } from "zod";

import type { CallContext } from "../../_shared/callContext.js";
import { quote, quoteListOrFillEmpty } from "../../_shared/format.js";
import { parseOutput } from "../../_shared/parseOutput.js";
import { expectFloat, parse } from "../../parse.js";

export const DeltaSimulationResultsInputSchema = z.object({
  filename: z.string().describe("Result file under test."),
  reffilename: z.string().describe("Reference result file to compare against."),
  method: z
    .enum(["1norm", "2norm", "maxerr"])
    .describe("Error aggregation method: sum, Euclidean, or supremum."),
  vars: z
    .array(z.string())
    .optional()
    .default([])
    .describe(
      "Variables to include in the error aggregate. Empty (the default) aggregates every variable.",
    ),
});
export type DeltaSimulationResultsInput = z.input<
  typeof DeltaSimulationResultsInputSchema
>;

export const DeltaSimulationResultsOutputSchema = z.object({
  result: z
    .number()
    .describe(
      "Aggregated error scalar under the chosen norm; 0.0 means the files are bit-equivalent.",
    ),
});
export type DeltaSimulationResultsOutput = z.infer<
  typeof DeltaSimulationResultsOutputSchema
>;

export const DeltaSimulationResultsDescription =
  "Aggregate the absolute error between two simulation result files into a scalar (1norm / 2norm / maxerr).";

export async function deltaSimulationResults(
  ctx: CallContext,
  input: DeltaSimulationResultsInput,
): Promise<DeltaSimulationResultsOutput> {
  const vars = input.vars ?? [];
  const raw = await ctx.call(
    `deltaSimulationResults(${quote(input.filename)}, ${quote(input.reffilename)}, ${quote(input.method)}, ${quoteListOrFillEmpty(vars)})`,
  );
  return parseOutput(
    DeltaSimulationResultsOutputSchema,
    { result: expectFloat(parse(raw)) },
    "deltaSimulationResults",
  );
}
