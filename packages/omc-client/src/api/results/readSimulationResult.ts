/**
 * OMC: `function readSimulationResult`
 *
 * ```modelica
 * function readSimulationResult
 *   input String filename;
 *   input VariableNames variables;
 *   input Integer size = 0;
 *   output Real result[:, :];
 * end readSimulationResult;
 * ```
 *
 * `variables` is a list of dotted-path variable identifiers emitted as a
 * brace-list (e.g. `{a.b, a[1].b[3].c}`). `size = 0` reads any size; a
 * non-zero `size` that doesn't match the file makes OMC fail.
 */

import { z } from "zod";

import type { CallContext } from "../../_shared/callContext.js";
import { quote } from "../../_shared/format.js";
import { parseOutput } from "../../_shared/parseOutput.js";
import { asFloat, expectList, parse } from "../../parse.js";

export const ReadSimulationResultInputSchema = z.object({
  filename: z.string().describe("Path to the simulation result file (.mat / .csv / etc.)."),
  variables: z.array(z.string()).describe("Variable identifiers to read (dotted paths)."),
  size: z.number().int().optional().default(0).describe("Number of rows expected; 0 reads any size, non-zero must match the file."),
});
export type ReadSimulationResultInput = z.input<
  typeof ReadSimulationResultInputSchema
>;

export const ReadSimulationResultOutputSchema = z.object({
  result: z.array(z.array(z.number())).describe("Variable values as a 2D `Real[:, :]` matrix (one row per variable in the same order as `variables`)."),
});
export type ReadSimulationResultOutput = z.infer<
  typeof ReadSimulationResultOutputSchema
>;

export const ReadSimulationResultDescription =
  "Read the values of named variables from a simulation result file as a 2D `Real[:, :]` matrix.";

export async function readSimulationResult(
  ctx: CallContext,
  input: ReadSimulationResultInput,
): Promise<ReadSimulationResultOutput> {
  const size = input.size ?? 0;
  const variableList = `{${input.variables.join(", ")}}`;
  const raw = await ctx.call(
    `readSimulationResult(${quote(input.filename)}, ${variableList}, ${size})`,
  );
  const rows = expectList(parse(raw));
  const result = rows.map((row) => {
    const items = expectList(row);
    return items.map((v) => asFloat(v) ?? 0);
  });
  return parseOutput(
    ReadSimulationResultOutputSchema,
    { result },
    "readSimulationResult",
  );
}
