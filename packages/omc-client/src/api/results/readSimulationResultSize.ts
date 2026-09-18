/**
 * OMC: `function readSimulationResultSize`
 *
 * Returns the number of stored rows (time points) in the result file — the
 * exact `size` `readSimulationResult` requires to read the file in full.
 *
 * A file OMC cannot open (missing, or carrying a suffix it does not know)
 * answers `-1` rather than failing, with the reason in the error buffer.
 */

import { z } from "zod";

import type { CallContext } from "../../_shared/callContext.js";
import { quote } from "../../_shared/format.js";
import {
  NO_REASON,
  failureReason,
  parseOutput,
} from "../../_shared/parseOutput.js";
import { OmcDiagnosticError } from "../../error-buffer.js";
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
    .nonnegative()
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
  const size = expectInt(parse(raw));
  if (size < 0) {
    const reason = (await failureReason(ctx)) ?? NO_REASON;
    throw new OmcDiagnosticError(`readSimulationResultSize: ${reason}`);
  }
  return parseOutput(
    ReadSimulationResultSizeOutputSchema,
    { size },
    "readSimulationResultSize",
  );
}
