/**
 * OMC: `function getNthEquation`
 *
 * Returns the n-th `equation` section in a class as a Modelica source string.
 *
 * ```modelica
 * function getNthEquation
 *   input TypeName class_;
 *   input Integer index;
 *   output String result;
 * end getNthEquation;
 * ```
 *
 * `index` is 1-based. There is no `getEquationCount` in the OMC scripting API;
 * use `getNthEquationItem` / `getNthEquation` and stop when OMC returns "".
 */

import { z } from "zod";

import type { CallContext } from "../../_shared/callContext.js";
import { TypeNameInput } from "../../_shared/inputs.js";
import { parseOutput } from "../../_shared/parseOutput.js";
import { asString, parse } from "../../parse.js";

export const GetNthEquationInputSchema = TypeNameInput.extend({
  index: z
    .number()
    .int()
    .positive()
    .describe("1-based equation-section index (OMC has no `getEquationCount`; empty result marks the end)."),
});
export type GetNthEquationInput = z.input<typeof GetNthEquationInputSchema>;

export const GetNthEquationOutputSchema = z.object({
  result: z
    .string()
    .describe("The n-th `equation` section as a Modelica source string. Field name `result` is OMC verbatim."),
});
export type GetNthEquationOutput = z.infer<typeof GetNthEquationOutputSchema>;

export const GetNthEquationDescription =
  "Return the n-th `equation` section in a class as a Modelica source string.";

export async function getNthEquation(
  ctx: CallContext,
  input: GetNthEquationInput,
): Promise<GetNthEquationOutput> {
  const raw = await ctx.call(
    `getNthEquation(${input.typeName}, ${input.index})`,
  );
  return parseOutput(
    GetNthEquationOutputSchema,
    { result: asString(parse(raw)) ?? "" },
    "getNthEquation",
  );
}
