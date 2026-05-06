/**
 * OMC: `function readSimulationResultSize`
 *
 * Returns the number of stored time steps in the result file.
 */

import { z } from "zod";

import type { CallContext } from "../../_shared/callContext.js";
import { quote } from "../../_shared/format.js";
import { parseOutput } from "../../_shared/parseOutput.js";
import { expectInt, parse } from "../../parse.js";

export const ReadSimulationResultSizeInputSchema = z.object({
  fileName: z.string(),
});
export type ReadSimulationResultSizeInput = z.input<
  typeof ReadSimulationResultSizeInputSchema
>;

export const ReadSimulationResultSizeOutputSchema = z.object({
  size: z.number().int(),
});
export type ReadSimulationResultSizeOutput = z.infer<
  typeof ReadSimulationResultSizeOutputSchema
>;

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
