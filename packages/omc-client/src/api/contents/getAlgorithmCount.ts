/**
 * OMC: `function getAlgorithmCount`
 *
 * Counts the number of `algorithm` sections in a class.
 *
 * ```modelica
 * function getAlgorithmCount
 *   input TypeName class_;
 *   output Integer count;
 * end getAlgorithmCount;
 * ```
 *
 * Pairs with `getNthAlgorithm(typeName, index)` for 1-based iteration.
 */

import { z } from "zod";

import type { CallContext } from "../../_shared/callContext.js";
import { TypeNameInput } from "../../_shared/inputs.js";
import { parseOutput } from "../../_shared/parseOutput.js";
import { expectInt, parse } from "../../parse.js";

export const GetAlgorithmCountInputSchema = TypeNameInput;
export type GetAlgorithmCountInput = z.input<
  typeof GetAlgorithmCountInputSchema
>;

export const GetAlgorithmCountOutputSchema = z.object({
  count: z.number().int().describe("Number of `algorithm` sections in the class."),
});
export type GetAlgorithmCountOutput = z.infer<
  typeof GetAlgorithmCountOutputSchema
>;

export const GetAlgorithmCountDescription =
  "Count the number of `algorithm` sections in a class. Pairs with `getNthAlgorithm`.";

export async function getAlgorithmCount(
  ctx: CallContext,
  input: GetAlgorithmCountInput,
): Promise<GetAlgorithmCountOutput> {
  const raw = await ctx.call(`getAlgorithmCount(${input.typeName})`);
  return parseOutput(
    GetAlgorithmCountOutputSchema,
    { count: expectInt(parse(raw)) },
    "getAlgorithmCount",
  );
}
