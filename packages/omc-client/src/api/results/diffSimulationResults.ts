/**
 * OMC: `function diffSimulationResults`
 *
 * ```modelica
 * function diffSimulationResults
 *   input String actualFile;
 *   input String expectedFile;
 *   input String diffPrefix;
 *   input Real relTol = 1e-3 "y tolerance";
 *   input Real relTolDiffMinMax = 1e-4 "y tolerance based on the difference between the maximum and minimum of the signal";
 *   input Real rangeDelta = 0.002 "x tolerance";
 *   input String[:] vars = fill("", 0);
 *   input Boolean keepEqualResults = false;
 *   output Boolean success;
 *   output String[:] failVars;
 * end diffSimulationResults;
 * ```
 *
 * Compares two simulation result files variable-by-variable with separate
 * y/y-range/x tolerances. Mismatched variables get exported to per-variable
 * CSV files named `<diffPrefix>.<varName>.csv` (caller is responsible for
 * cleaning them up). `keepEqualResults=true` also exports CSVs for the
 * variables that matched, for completeness.
 *
 * Returns BOTH a success flag and the list of variables that mismatched
 * — the wrapper exposes them as a 2-field object since OMC's interactive
 * RPC returns them as a paren-tuple `(success, failVars)`.
 */

import { z } from "zod";

import type { CallContext } from "../../_shared/callContext.js";
import { mlBool, quote, quoteListOrFillEmpty } from "../../_shared/format.js";
import { parseOutput } from "../../_shared/parseOutput.js";
import { expectBool, expectList, expectStringList, parse } from "../../parse.js";

export const DiffSimulationResultsInputSchema = z.object({
  actualFile: z.string().describe("Actual simulation result file."),
  expectedFile: z.string().describe("Expected (reference) simulation result file."),
  diffPrefix: z
    .string()
    .describe(
      "Prefix for the per-variable CSV files written for mismatches: `<diffPrefix>.<varName>.csv`.",
    ),
  relTol: z.number().optional().default(1e-3).describe("Per-point relative y-tolerance."),
  relTolDiffMinMax: z
    .number()
    .optional()
    .default(1e-4)
    .describe("Relative y-tolerance scaled by the signal's (max − min)."),
  rangeDelta: z.number().optional().default(0.002).describe("x (time) tolerance."),
  vars: z
    .array(z.string())
    .optional()
    .default([])
    .describe(
      "Variables to compare. Empty (the default) compares every variable in `actualFile`.",
    ),
  keepEqualResults: z
    .boolean()
    .optional()
    .default(false)
    .describe(
      "Also export per-variable CSVs for variables that matched (useful for full audit trails).",
    ),
});
export type DiffSimulationResultsInput = z.input<
  typeof DiffSimulationResultsInputSchema
>;

export const DiffSimulationResultsOutputSchema = z.object({
  success: z
    .boolean()
    .describe("True if no variable's diff exceeded the tolerances."),
  failVars: z
    .array(z.string())
    .describe("Variable names whose diff exceeded the tolerances; empty when `success` is true."),
});
export type DiffSimulationResultsOutput = z.infer<
  typeof DiffSimulationResultsOutputSchema
>;

export const DiffSimulationResultsDescription =
  "Compare two simulation result files per-variable with separate y / y-range / x tolerances; mismatches exported as per-variable CSV files.";

export async function diffSimulationResults(
  ctx: CallContext,
  input: DiffSimulationResultsInput,
): Promise<DiffSimulationResultsOutput> {
  const vars = input.vars ?? [];
  const raw = await ctx.call(
    `diffSimulationResults(${quote(input.actualFile)}, ${quote(input.expectedFile)}, ${quote(input.diffPrefix)}, ${input.relTol ?? 1e-3}, ${input.relTolDiffMinMax ?? 1e-4}, ${input.rangeDelta ?? 0.002}, ${quoteListOrFillEmpty(vars)}, ${mlBool(input.keepEqualResults ?? false)})`,
  );
  // OMC returns a paren-tuple `(success, {failVars...})`.
  const tuple = expectList(parse(raw));
  if (tuple.length !== 2) {
    throw new Error(
      `diffSimulationResults: expected 2-tuple, got ${tuple.length} elements`,
    );
  }
  return parseOutput(
    DiffSimulationResultsOutputSchema,
    {
      success: expectBool(tuple[0]!),
      failVars: expectStringList(tuple[1]!),
    },
    "diffSimulationResults",
  );
}
