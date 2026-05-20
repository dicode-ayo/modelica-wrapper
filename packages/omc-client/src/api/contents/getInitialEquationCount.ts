/**
 * OMC: `function getInitialEquationCount`
 *
 * Counts the number of `initial equation` sections in a class.
 *
 * ```modelica
 * function getInitialEquationCount
 *   input TypeName class_;
 *   output Integer count;
 * end getInitialEquationCount;
 * ```
 *
 * Pairs with `getNthInitialEquation(typeName, index)` for 1-based iteration.
 */

import { z } from "zod";

import type { CallContext } from "../../_shared/callContext.js";
import { TypeNameInput } from "../../_shared/inputs.js";
import { parseOutput } from "../../_shared/parseOutput.js";
import { expectInt, parse } from "../../parse.js";

export const GetInitialEquationCountInputSchema = TypeNameInput;
export type GetInitialEquationCountInput = z.input<
  typeof GetInitialEquationCountInputSchema
>;

export const GetInitialEquationCountOutputSchema = z.object({
  count: z.number().int().describe("Number of `initial equation` sections in the class."),
});
export type GetInitialEquationCountOutput = z.infer<
  typeof GetInitialEquationCountOutputSchema
>;

export const GetInitialEquationCountDescription =
  "Count the number of `initial equation` sections in a class. Pairs with `getNthInitialEquation`.";

export async function getInitialEquationCount(
  ctx: CallContext,
  input: GetInitialEquationCountInput,
): Promise<GetInitialEquationCountOutput> {
  const raw = await ctx.call(`getInitialEquationCount(${input.typeName})`);
  return parseOutput(
    GetInitialEquationCountOutputSchema,
    { count: expectInt(parse(raw)) },
    "getInitialEquationCount",
  );
}
