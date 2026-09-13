/**
 * OMC: `function getNthComponentModification`
 *
 * Returns the modification of the n-th component in a class, as a list of
 * Modelica expression/modification trees.
 *
 * ```modelica
 * function getNthComponentModification
 *   input TypeName className;
 *   input Integer n;
 *   output ExpressionOrModification result[:];
 * end getNthComponentModification;
 * ```
 *
 * `result` is returned as the raw `Value` tree (per audit.md §2.4 for
 * `ExpressionOrModification[:]` outputs); the wrapper preserves the array
 * shape verbatim. `n` is 1-based, in `1..getComponentCount`.
 */

import { z } from "zod";

import type { CallContext } from "../../_shared/callContext.js";
import { TypeNameInput } from "../../_shared/inputs.js";
import { parseOutput } from "../../_shared/parseOutput.js";
import { ValueSchema } from "../../_shared/value.js";
import { parse } from "../../parse.js";

export const GetNthComponentModificationInputSchema = TypeNameInput.extend({
  n: z
    .number()
    .int()
    .positive()
    .describe("1-based component index, between 1 and `getComponentCount`."),
});
export type GetNthComponentModificationInput = z.input<
  typeof GetNthComponentModificationInputSchema
>;

export const GetNthComponentModificationOutputSchema = z.object({
  result: ValueSchema.describe(
    "Modification of the n-th component as a Modelica expression/modification tree (raw `Value`; OMC declares `ExpressionOrModification[:]`).",
  ),
});
export type GetNthComponentModificationOutput = z.infer<
  typeof GetNthComponentModificationOutputSchema
>;

export const GetNthComponentModificationDescription =
  "Return the modification of the n-th component in a class as a Modelica expression/modification tree. Pairs with `getComponentCount`.";

export async function getNthComponentModification(
  ctx: CallContext,
  input: GetNthComponentModificationInput,
): Promise<GetNthComponentModificationOutput> {
  const raw = await ctx.call(
    `getNthComponentModification(${input.typeName}, ${input.n})`,
  );
  return parseOutput(
    GetNthComponentModificationOutputSchema,
    { result: parse(raw) },
    "getNthComponentModification",
  );
}
