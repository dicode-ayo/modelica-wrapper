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
  filename: z.string(),
  variables: z.array(z.string()),
  size: z.number().int().optional().default(0),
});
export type ReadSimulationResultInput = z.input<
  typeof ReadSimulationResultInputSchema
>;

export const ReadSimulationResultOutputSchema = z.object({
  result: z.array(z.array(z.number())),
});
export type ReadSimulationResultOutput = z.infer<
  typeof ReadSimulationResultOutputSchema
>;

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
