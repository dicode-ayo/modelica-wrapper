/**
 * OMC: `function closeSimulationResultFile`
 *
 * Asks OMC to release any open handle on the result file.
 */

import { z } from "zod";

import type { CallContext } from "../../_shared/callContext.js";
import { SuccessOutput } from "../../_shared/outputs.js";
import { parseOutput } from "../../_shared/parseOutput.js";
import { expectBool, parse } from "../../parse.js";

export const CloseSimulationResultFileInputSchema = z.object({});
export type CloseSimulationResultFileInput = z.input<
  typeof CloseSimulationResultFileInputSchema
>;

export const CloseSimulationResultFileOutputSchema = SuccessOutput;
export type CloseSimulationResultFileOutput = z.infer<
  typeof CloseSimulationResultFileOutputSchema
>;

export async function closeSimulationResultFile(
  ctx: CallContext,
  _input: CloseSimulationResultFileInput = {},
): Promise<CloseSimulationResultFileOutput> {
  const raw = await ctx.call("closeSimulationResultFile()");
  return parseOutput(
    CloseSimulationResultFileOutputSchema,
    { success: expectBool(parse(raw)) },
    "closeSimulationResultFile",
  );
}
