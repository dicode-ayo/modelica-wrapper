/**
 * OMC: `function getAlgorithmItemsCount`
 *
 * Counts the number of statements across all `algorithm` sections in a class.
 *
 * ```modelica
 * function getAlgorithmItemsCount
 *   input TypeName class_;
 *   output Integer count;
 * end getAlgorithmItemsCount;
 * ```
 *
 * Pairs with `getNthAlgorithmItem(typeName, index)` for 1-based iteration.
 */

import { z } from "zod";

import type { CallContext } from "../../_shared/callContext.js";
import { TypeNameInput } from "../../_shared/inputs.js";
import { parseOutput } from "../../_shared/parseOutput.js";
import { expectInt, parse } from "../../parse.js";

export const GetAlgorithmItemsCountInputSchema = TypeNameInput;
export type GetAlgorithmItemsCountInput = z.input<
  typeof GetAlgorithmItemsCountInputSchema
>;

export const GetAlgorithmItemsCountOutputSchema = z.object({
  count: z
    .number()
    .int()
    .describe(
      "Number of individual statements across the class's `algorithm` sections.",
    ),
});
export type GetAlgorithmItemsCountOutput = z.infer<
  typeof GetAlgorithmItemsCountOutputSchema
>;

export const GetAlgorithmItemsCountDescription =
  "Count the number of statements across all `algorithm` sections in a class. Pairs with `getNthAlgorithmItem`.";

export async function getAlgorithmItemsCount(
  ctx: CallContext,
  input: GetAlgorithmItemsCountInput,
): Promise<GetAlgorithmItemsCountOutput> {
  const raw = await ctx.call(`getAlgorithmItemsCount(${input.typeName})`);
  return parseOutput(
    GetAlgorithmItemsCountOutputSchema,
    { count: expectInt(parse(raw)) },
    "getAlgorithmItemsCount",
  );
}
