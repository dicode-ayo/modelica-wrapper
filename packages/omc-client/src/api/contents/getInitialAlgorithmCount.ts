/**
 * OMC: `function getInitialAlgorithmCount`
 *
 * Counts the number of `initial algorithm` sections in a class.
 *
 * ```modelica
 * function getInitialAlgorithmCount
 *   input TypeName class_;
 *   output Integer count;
 * end getInitialAlgorithmCount;
 * ```
 *
 * Pairs with `getNthInitialAlgorithm(typeName, index)` for 1-based iteration.
 */

import { z } from "zod";

import type { CallContext } from "../../_shared/callContext.js";
import { TypeNameInput } from "../../_shared/inputs.js";
import { parseOutput } from "../../_shared/parseOutput.js";
import { expectInt, parse } from "../../parse.js";

export const GetInitialAlgorithmCountInputSchema = TypeNameInput;
export type GetInitialAlgorithmCountInput = z.input<
  typeof GetInitialAlgorithmCountInputSchema
>;

export const GetInitialAlgorithmCountOutputSchema = z.object({
  count: z
    .number()
    .int()
    .describe("Number of `initial algorithm` sections in the class."),
});
export type GetInitialAlgorithmCountOutput = z.infer<
  typeof GetInitialAlgorithmCountOutputSchema
>;

export const GetInitialAlgorithmCountDescription =
  "Count the number of `initial algorithm` sections in a class. Pairs with `getNthInitialAlgorithm`.";

export async function getInitialAlgorithmCount(
  ctx: CallContext,
  input: GetInitialAlgorithmCountInput,
): Promise<GetInitialAlgorithmCountOutput> {
  const raw = await ctx.call(`getInitialAlgorithmCount(${input.typeName})`);
  return parseOutput(
    GetInitialAlgorithmCountOutputSchema,
    { count: expectInt(parse(raw)) },
    "getInitialAlgorithmCount",
  );
}
