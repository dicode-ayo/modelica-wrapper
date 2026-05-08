/**
 * OMC: `function setMatchingAlgorithm`
 *
 * Pick the matching algorithm (e.g. "PFPlusExt", "BFSB").
 */

import { z } from "zod";

import type { CallContext } from "../../_shared/callContext.js";
import { quote } from "../../_shared/format.js";
import { SuccessOutput } from "../../_shared/outputs.js";
import { parseOutput } from "../../_shared/parseOutput.js";
import { expectBool, parse } from "../../parse.js";

export const SetMatchingAlgorithmInputSchema = z.object({
  algorithm: z.string().describe('Matching algorithm name, e.g. "PFPlus", "PFPlusExt", "BFSB".'),
});
export type SetMatchingAlgorithmInput = z.input<
  typeof SetMatchingAlgorithmInputSchema
>;

export const SetMatchingAlgorithmOutputSchema = SuccessOutput;
export type SetMatchingAlgorithmOutput = z.infer<
  typeof SetMatchingAlgorithmOutputSchema
>;

export const SetMatchingAlgorithmDescription = "Set the matching algorithm used by OMC's backend after pre-optimization.";

export async function setMatchingAlgorithm(
  ctx: CallContext,
  input: SetMatchingAlgorithmInput,
): Promise<SetMatchingAlgorithmOutput> {
  const raw = await ctx.call(`setMatchingAlgorithm(${quote(input.algorithm)})`);
  return parseOutput(
    SetMatchingAlgorithmOutputSchema,
    { success: expectBool(parse(raw)) },
    "setMatchingAlgorithm",
  );
}
