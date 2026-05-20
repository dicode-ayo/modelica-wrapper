/**
 * OMC: `function getNthInitialAlgorithmItem`
 *
 * Returns the n-th statement across all `initial algorithm` sections in a
 * class, as a Modelica source string.
 *
 * ```modelica
 * function getNthInitialAlgorithmItem
 *   input TypeName class_;
 *   input Integer index;
 *   output String result;
 * end getNthInitialAlgorithmItem;
 * ```
 *
 * `index` is 1-based, in `1..getInitialAlgorithmItemsCount`.
 */

import { z } from "zod";

import type { CallContext } from "../../_shared/callContext.js";
import { TypeNameInput } from "../../_shared/inputs.js";
import { parseOutput } from "../../_shared/parseOutput.js";
import { asString, parse } from "../../parse.js";

export const GetNthInitialAlgorithmItemInputSchema = TypeNameInput.extend({
  index: z
    .number()
    .int()
    .positive()
    .describe("1-based initial-algorithm-statement index, between 1 and `getInitialAlgorithmItemsCount`."),
});
export type GetNthInitialAlgorithmItemInput = z.input<
  typeof GetNthInitialAlgorithmItemInputSchema
>;

export const GetNthInitialAlgorithmItemOutputSchema = z.object({
  result: z
    .string()
    .describe("The n-th `initial algorithm` statement as a Modelica source string. Field name `result` is OMC verbatim."),
});
export type GetNthInitialAlgorithmItemOutput = z.infer<
  typeof GetNthInitialAlgorithmItemOutputSchema
>;

export const GetNthInitialAlgorithmItemDescription =
  "Return the n-th statement across all `initial algorithm` sections in a class as a Modelica source string. Pairs with `getInitialAlgorithmItemsCount`.";

export async function getNthInitialAlgorithmItem(
  ctx: CallContext,
  input: GetNthInitialAlgorithmItemInput,
): Promise<GetNthInitialAlgorithmItemOutput> {
  const raw = await ctx.call(
    `getNthInitialAlgorithmItem(${input.typeName}, ${input.index})`,
  );
  return parseOutput(
    GetNthInitialAlgorithmItemOutputSchema,
    { result: asString(parse(raw)) ?? "" },
    "getNthInitialAlgorithmItem",
  );
}
