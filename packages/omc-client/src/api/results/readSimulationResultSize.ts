/**
 * OMC: `function readSimulationResultSize`
 *
 * Returns the number of stored rows (time points) in the result file — the
 * exact `size` `readSimulationResult` requires to read the file in full.
 */

import { z } from "zod";

import type { CallContext } from "../../_shared/callContext.js";
import { quote } from "../../_shared/format.js";
import { parseOutput } from "../../_shared/parseOutput.js";
import { expectInt, parse } from "../../parse.js";

export const ReadSimulationResultSizeInputSchema = z.strictObject({
  fileName: z
    .string()
    .describe("Path to the simulation result file to inspect."),
});
export type ReadSimulationResultSizeInput = z.input<
  typeof ReadSimulationResultSizeInputSchema
>;

export const ReadSimulationResultSizeOutputSchema = z.object({
  size: z
    .number()
    .int()
    .describe("Number of stored rows (time points) in the result file."),
});
export type ReadSimulationResultSizeOutput = z.infer<
  typeof ReadSimulationResultSizeOutputSchema
>;

export const ReadSimulationResultSizeDescription =
  "Return the number of rows (time points) stored in a simulation result file.";

export async function readSimulationResultSize(
  ctx: CallContext,
  input: ReadSimulationResultSizeInput,
): Promise<ReadSimulationResultSizeOutput> {
  const raw = await ctx.call(
    `readSimulationResultSize(${quote(input.fileName)})`,
  );
  return parseOutput(
    ReadSimulationResultSizeOutputSchema,
    { size: expectInt(parse(raw)) },
    "readSimulationResultSize",
  );
}
