/**
 * OMC: `function getNthAlgorithmItem`
 *
 * Returns the n-th statement across all `algorithm` sections in a class, as a
 * Modelica source string.
 *
 * ```modelica
 * function getNthAlgorithmItem
 *   input TypeName class_;
 *   input Integer index;
 *   output String result;
 * end getNthAlgorithmItem;
 * ```
 *
 * `index` is 1-based, in `1..getAlgorithmItemsCount`.
 */

import { z } from "zod";

import type { CallContext } from "../../_shared/callContext.js";
import { TypeNameInput } from "../../_shared/inputs.js";
import { parseOutput } from "../../_shared/parseOutput.js";
import { asString, parse } from "../../parse.js";

export const GetNthAlgorithmItemInputSchema = TypeNameInput.extend({
  index: z
    .number()
    .int()
    .positive()
    .describe("1-based algorithm-statement index, between 1 and `getAlgorithmItemsCount`."),
});
export type GetNthAlgorithmItemInput = z.input<
  typeof GetNthAlgorithmItemInputSchema
>;

export const GetNthAlgorithmItemOutputSchema = z.object({
  result: z
    .string()
    .describe("The n-th `algorithm` statement as a Modelica source string. Field name `result` is OMC verbatim."),
});
export type GetNthAlgorithmItemOutput = z.infer<
  typeof GetNthAlgorithmItemOutputSchema
>;

export const GetNthAlgorithmItemDescription =
  "Return the n-th statement across all `algorithm` sections in a class as a Modelica source string. Pairs with `getAlgorithmItemsCount`.";

export async function getNthAlgorithmItem(
  ctx: CallContext,
  input: GetNthAlgorithmItemInput,
): Promise<GetNthAlgorithmItemOutput> {
  const raw = await ctx.call(
    `getNthAlgorithmItem(${input.typeName}, ${input.index})`,
  );
  return parseOutput(
    GetNthAlgorithmItemOutputSchema,
    { result: asString(parse(raw)) ?? "" },
    "getNthAlgorithmItem",
  );
}
