/**
 * OMC: `function getNthComponentCondition`
 *
 * Returns the conditional-declaration expression (`if` condition) of the n-th
 * component in a class, as a string.
 *
 * ```modelica
 * function getNthComponentCondition
 *   input TypeName className;
 *   input Integer n;
 *   output String result;
 * end getNthComponentCondition;
 * ```
 *
 * Empty string when the component has no `if`-condition. `n` is 1-based, in
 * `1..getComponentCount`.
 */

import { z } from "zod";

import type { CallContext } from "../../_shared/callContext.js";
import { TypeNameInput } from "../../_shared/inputs.js";
import { parseOutput } from "../../_shared/parseOutput.js";
import { asString, parse } from "../../parse.js";

export const GetNthComponentConditionInputSchema = TypeNameInput.extend({
  n: z
    .number()
    .int()
    .positive()
    .describe("1-based component index, between 1 and `getComponentCount`."),
});
export type GetNthComponentConditionInput = z.input<
  typeof GetNthComponentConditionInputSchema
>;

export const GetNthComponentConditionOutputSchema = z.object({
  result: z
    .string()
    .describe(
      "Conditional-declaration expression of the n-th component; empty if unconditional. Field name `result` is OMC verbatim.",
    ),
});
export type GetNthComponentConditionOutput = z.infer<
  typeof GetNthComponentConditionOutputSchema
>;

export const GetNthComponentConditionDescription =
  "Return the conditional-declaration (`if`) expression of the n-th component in a class as a string; empty if the component is unconditional.";

export async function getNthComponentCondition(
  ctx: CallContext,
  input: GetNthComponentConditionInput,
): Promise<GetNthComponentConditionOutput> {
  const raw = await ctx.call(
    `getNthComponentCondition(${input.typeName}, ${input.n})`,
  );
  return parseOutput(
    GetNthComponentConditionOutputSchema,
    { result: asString(parse(raw)) ?? "" },
    "getNthComponentCondition",
  );
}
