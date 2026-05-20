/**
 * OMC: `function getNthEquationItem`
 *
 * Returns the n-th individual equation across all `equation` sections in a
 * class, as a Modelica source string.
 *
 * ```modelica
 * function getNthEquationItem
 *   input TypeName class_;
 *   input Integer index;
 *   output String result;
 * end getNthEquationItem;
 * ```
 *
 * `index` is 1-based. There is no `getEquationItemsCount` in the OMC scripting
 * API; iterate until OMC returns "".
 */

import { z } from "zod";

import type { CallContext } from "../../_shared/callContext.js";
import { TypeNameInput } from "../../_shared/inputs.js";
import { parseOutput } from "../../_shared/parseOutput.js";
import { asString, parse } from "../../parse.js";

export const GetNthEquationItemInputSchema = TypeNameInput.extend({
  index: z
    .number()
    .int()
    .positive()
    .describe("1-based equation index (OMC has no `getEquationItemsCount`; empty result marks the end)."),
});
export type GetNthEquationItemInput = z.input<
  typeof GetNthEquationItemInputSchema
>;

export const GetNthEquationItemOutputSchema = z.object({
  result: z
    .string()
    .describe("The n-th `equation` as a Modelica source string. Field name `result` is OMC verbatim."),
});
export type GetNthEquationItemOutput = z.infer<
  typeof GetNthEquationItemOutputSchema
>;

export const GetNthEquationItemDescription =
  "Return the n-th individual equation across all `equation` sections in a class as a Modelica source string.";

export async function getNthEquationItem(
  ctx: CallContext,
  input: GetNthEquationItemInput,
): Promise<GetNthEquationItemOutput> {
  const raw = await ctx.call(
    `getNthEquationItem(${input.typeName}, ${input.index})`,
  );
  return parseOutput(
    GetNthEquationItemOutputSchema,
    { result: asString(parse(raw)) ?? "" },
    "getNthEquationItem",
  );
}
