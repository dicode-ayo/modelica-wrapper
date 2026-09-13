/**
 * OMC: `function getNthInitialEquationItem`
 *
 * Returns the n-th individual equation across all `initial equation` sections
 * in a class, as a Modelica source string.
 *
 * ```modelica
 * function getNthInitialEquationItem
 *   input TypeName class_;
 *   input Integer index;
 *   output String result;
 * end getNthInitialEquationItem;
 * ```
 *
 * `index` is 1-based, in `1..getInitialEquationItemsCount`.
 */

import { z } from "zod";

import type { CallContext } from "../../_shared/callContext.js";
import { TypeNameInput } from "../../_shared/inputs.js";
import { parseOutput } from "../../_shared/parseOutput.js";
import { asString, parse } from "../../parse.js";

export const GetNthInitialEquationItemInputSchema = TypeNameInput.extend({
  index: z
    .number()
    .int()
    .positive()
    .describe(
      "1-based initial-equation index, between 1 and `getInitialEquationItemsCount`.",
    ),
});
export type GetNthInitialEquationItemInput = z.input<
  typeof GetNthInitialEquationItemInputSchema
>;

export const GetNthInitialEquationItemOutputSchema = z.object({
  result: z
    .string()
    .describe(
      "The n-th `initial equation` as a Modelica source string. Field name `result` is OMC verbatim.",
    ),
});
export type GetNthInitialEquationItemOutput = z.infer<
  typeof GetNthInitialEquationItemOutputSchema
>;

export const GetNthInitialEquationItemDescription =
  "Return the n-th individual equation across all `initial equation` sections in a class as a Modelica source string. Pairs with `getInitialEquationItemsCount`.";

export async function getNthInitialEquationItem(
  ctx: CallContext,
  input: GetNthInitialEquationItemInput,
): Promise<GetNthInitialEquationItemOutput> {
  const raw = await ctx.call(
    `getNthInitialEquationItem(${input.typeName}, ${input.index})`,
  );
  return parseOutput(
    GetNthInitialEquationItemOutputSchema,
    { result: asString(parse(raw)) ?? "" },
    "getNthInitialEquationItem",
  );
}
