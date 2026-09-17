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
 * brace-list (e.g. `{a.b, a[1].b[3].c}`). OMC's own `size = 0` ("any size")
 * silently returns an empty matrix on some result formats instead of the
 * documented behavior, so a `size` of 0 (or omitted) here is resolved via
 * `readSimulationResultSize` first and that row count is passed through —
 * callers never see the raw `size = 0` bug. Passing a non-zero `size`
 * still requires an exact match to the file's row count, which is the
 * number of simulated intervals plus 2 (OMC duplicates the final time
 * point): a run of N intervals stores N + 2 rows.
 */

import { z } from "zod";

import type { CallContext } from "../../_shared/callContext.js";
import { resultVariable } from "../../_shared/fields.js";
import { quote } from "../../_shared/format.js";
import { parseOutput } from "../../_shared/parseOutput.js";
import { asFloat, expectList, parse } from "../../parse.js";
import { readSimulationResultSize } from "./readSimulationResultSize.js";

export const ReadSimulationResultInputSchema = z.strictObject({
  filename: z
    .string()
    .describe("Path to the simulation result file (.mat / .csv / etc.)."),
  variables: z
    .array(resultVariable)
    .describe(
      "Variable identifiers to read (dotted paths), each emitted to OMC unquoted.",
    ),
  size: z
    .number()
    .int()
    .optional()
    .default(0)
    .describe(
      "Number of rows expected; 0 (default) resolves the file's actual row " +
        "count for you, non-zero must match the file exactly. A file holds " +
        "numberOfIntervals + 2 rows (OMC duplicates the final time point).",
    ),
});
export type ReadSimulationResultInput = z.input<
  typeof ReadSimulationResultInputSchema
>;

export const ReadSimulationResultOutputSchema = z.object({
  result: z
    .array(z.array(z.number()))
    .describe(
      "Variable values as a 2D `Real[:, :]` matrix (one row per variable in the same order as `variables`).",
    ),
});
export type ReadSimulationResultOutput = z.infer<
  typeof ReadSimulationResultOutputSchema
>;

export const ReadSimulationResultDescription =
  "Read the values of named variables from a simulation result file as a 2D `Real[:, :]` matrix. " +
  "A row count of 0 (default) resolves the file's real row count automatically; a file holds " +
  "numberOfIntervals + 2 rows (OMC duplicates the final time point).";

async function resolveSize(
  ctx: CallContext,
  input: ReadSimulationResultInput,
): Promise<number> {
  const requestedSize = input.size ?? 0;
  if (requestedSize !== 0) return requestedSize;
  const { size } = await readSimulationResultSize(ctx, {
    fileName: input.filename,
  });
  return size;
}

export async function readSimulationResult(
  ctx: CallContext,
  input: ReadSimulationResultInput,
): Promise<ReadSimulationResultOutput> {
  const size = await resolveSize(ctx, input);
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
