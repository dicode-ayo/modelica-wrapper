/**
 * OMC: `function getInitialAlgorithmItemsCount`
 *
 * Counts the number of statements across all `initial algorithm` sections in
 * a class.
 *
 * ```modelica
 * function getInitialAlgorithmItemsCount
 *   input TypeName class_;
 *   output Integer count;
 * end getInitialAlgorithmItemsCount;
 * ```
 *
 * Pairs with `getNthInitialAlgorithmItem(typeName, index)` for 1-based iteration.
 */

import { z } from "zod";

import type { CallContext } from "../../_shared/callContext.js";
import { TypeNameInput } from "../../_shared/inputs.js";
import { parseOutput } from "../../_shared/parseOutput.js";
import { expectInt, parse } from "../../parse.js";

export const GetInitialAlgorithmItemsCountInputSchema = TypeNameInput;
export type GetInitialAlgorithmItemsCountInput = z.input<
  typeof GetInitialAlgorithmItemsCountInputSchema
>;

export const GetInitialAlgorithmItemsCountOutputSchema = z.object({
  count: z
    .number()
    .int()
    .describe(
      "Number of individual statements across the class's `initial algorithm` sections.",
    ),
});
export type GetInitialAlgorithmItemsCountOutput = z.infer<
  typeof GetInitialAlgorithmItemsCountOutputSchema
>;

export const GetInitialAlgorithmItemsCountDescription =
  "Count the number of statements across all `initial algorithm` sections in a class. Pairs with `getNthInitialAlgorithmItem`.";

export async function getInitialAlgorithmItemsCount(
  ctx: CallContext,
  input: GetInitialAlgorithmItemsCountInput,
): Promise<GetInitialAlgorithmItemsCountOutput> {
  const raw = await ctx.call(
    `getInitialAlgorithmItemsCount(${input.typeName})`,
  );
  return parseOutput(
    GetInitialAlgorithmItemsCountOutputSchema,
    { count: expectInt(parse(raw)) },
    "getInitialAlgorithmItemsCount",
  );
}
