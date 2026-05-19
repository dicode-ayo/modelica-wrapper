/**
 * OMC: `function compareSimulationResults`
 *
 * ```modelica
 * function compareSimulationResults
 *   input String filename;
 *   input String reffilename;
 *   input String logfilename;
 *   input Real relTol = 0.01;
 *   input Real absTol = 0.0001;
 *   input String[:] vars = fill("", 0);
 *   output String[:] result;
 * end compareSimulationResults;
 * ```
 *
 * Compares two simulation result files with per-variable tolerances and
 * writes a textual log to `logfilename`. The output is a list of result
 * strings (typically one of `"Files Equal!"` or per-variable mismatch
 * reports). Empty `vars` compares every variable found in `filename`.
 *
 * Per OMC docs this function is **deprecated** in favor of
 * `diffSimulationResults` for new code, but kept for regression suites
 * that already depend on its tolerance semantics.
 *
 * @deprecated Marked deprecated in OMC's own docs. Prefer
 *             `diffSimulationResults` for new comparisons.
 */

import { z } from "zod";

import type { CallContext } from "../../_shared/callContext.js";
import { quote, quoteListOrFillEmpty } from "../../_shared/format.js";
import { parseOutput } from "../../_shared/parseOutput.js";
import { expectStringList, parse } from "../../parse.js";

export const CompareSimulationResultsInputSchema = z.object({
  filename: z.string().describe("Result file under test."),
  reffilename: z.string().describe("Reference result file to compare against."),
  logfilename: z.string().describe("Path where the textual diff log is written."),
  relTol: z.number().optional().default(0.01).describe("Relative tolerance per data point."),
  absTol: z.number().optional().default(0.0001).describe("Absolute tolerance per data point."),
  vars: z
    .array(z.string())
    .optional()
    .default([])
    .describe(
      "Variables to compare. Empty (the default) compares every variable found in `filename`.",
    ),
});
export type CompareSimulationResultsInput = z.input<
  typeof CompareSimulationResultsInputSchema
>;

export const CompareSimulationResultsOutputSchema = z.object({
  result: z
    .array(z.string())
    .describe(
      'Per-variable result strings; typically `["Files Equal!"]` on match or one entry per mismatched variable.',
    ),
});
export type CompareSimulationResultsOutput = z.infer<
  typeof CompareSimulationResultsOutputSchema
>;

export const CompareSimulationResultsDescription =
  "Compare two simulation result files with per-variable tolerances (deprecated by OMC — prefer diffSimulationResults).";

export async function compareSimulationResults(
  ctx: CallContext,
  input: CompareSimulationResultsInput,
): Promise<CompareSimulationResultsOutput> {
  const vars = input.vars ?? [];
  const raw = await ctx.call(
    `compareSimulationResults(${quote(input.filename)}, ${quote(input.reffilename)}, ${quote(input.logfilename)}, ${input.relTol ?? 0.01}, ${input.absTol ?? 0.0001}, ${quoteListOrFillEmpty(vars)})`,
  );
  return parseOutput(
    CompareSimulationResultsOutputSchema,
    { result: expectStringList(parse(raw)) },
    "compareSimulationResults",
  );
}
