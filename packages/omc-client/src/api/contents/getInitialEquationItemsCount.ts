/**
 * OMC: `function getInitialEquationItemsCount`
 *
 * Counts the number of equations across all `initial equation` sections in a
 * class.
 *
 * ```modelica
 * function getInitialEquationItemsCount
 *   input TypeName class_;
 *   output Integer count;
 * end getInitialEquationItemsCount;
 * ```
 *
 * Pairs with `getNthInitialEquationItem(typeName, index)` for 1-based iteration.
 */

import { z } from "zod";

import type { CallContext } from "../../_shared/callContext.js";
import { TypeNameInput } from "../../_shared/inputs.js";
import { parseOutput } from "../../_shared/parseOutput.js";
import { expectInt, parse } from "../../parse.js";

export const GetInitialEquationItemsCountInputSchema = TypeNameInput;
export type GetInitialEquationItemsCountInput = z.input<
  typeof GetInitialEquationItemsCountInputSchema
>;

export const GetInitialEquationItemsCountOutputSchema = z.object({
  count: z.number().int().describe("Number of individual equations across the class's `initial equation` sections."),
});
export type GetInitialEquationItemsCountOutput = z.infer<
  typeof GetInitialEquationItemsCountOutputSchema
>;

export const GetInitialEquationItemsCountDescription =
  "Count the number of equations across all `initial equation` sections in a class. Pairs with `getNthInitialEquationItem`.";

export async function getInitialEquationItemsCount(
  ctx: CallContext,
  input: GetInitialEquationItemsCountInput,
): Promise<GetInitialEquationItemsCountOutput> {
  const raw = await ctx.call(`getInitialEquationItemsCount(${input.typeName})`);
  return parseOutput(
    GetInitialEquationItemsCountOutputSchema,
    { count: expectInt(parse(raw)) },
    "getInitialEquationItemsCount",
  );
}
