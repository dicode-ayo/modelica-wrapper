/**
 * OMC: `function setIndexReductionMethod`
 *
 * Pick the index-reduction method (e.g. "dynamicStateSelection").
 */

import { z } from "zod";

import type { CallContext } from "../../_shared/callContext.js";
import { quote } from "../../_shared/format.js";
import { SuccessOutput } from "../../_shared/outputs.js";
import { parseOutput } from "../../_shared/parseOutput.js";
import { expectBool, parse } from "../../parse.js";

export const SetIndexReductionMethodInputSchema = z.object({
  method: z.string(),
});
export type SetIndexReductionMethodInput = z.input<
  typeof SetIndexReductionMethodInputSchema
>;

export const SetIndexReductionMethodOutputSchema = SuccessOutput;
export type SetIndexReductionMethodOutput = z.infer<
  typeof SetIndexReductionMethodOutputSchema
>;

export async function setIndexReductionMethod(
  ctx: CallContext,
  input: SetIndexReductionMethodInput,
): Promise<SetIndexReductionMethodOutput> {
  const raw = await ctx.call(
    `setIndexReductionMethod(${quote(input.method)})`,
  );
  return parseOutput(
    SetIndexReductionMethodOutputSchema,
    { success: expectBool(parse(raw)) },
    "setIndexReductionMethod",
  );
}
