/**
 * OMC: `function getNthInitialEquation`
 *
 * Returns the n-th `initial equation` section in a class as a Modelica source
 * string.
 *
 * ```modelica
 * function getNthInitialEquation
 *   input TypeName class_;
 *   input Integer index;
 *   output String result;
 * end getNthInitialEquation;
 * ```
 *
 * `index` is 1-based, in `1..getInitialEquationCount`.
 */

import { z } from "zod";

import type { CallContext } from "../../_shared/callContext.js";
import { TypeNameInput } from "../../_shared/inputs.js";
import { parseOutput } from "../../_shared/parseOutput.js";
import { asString, parse } from "../../parse.js";

export const GetNthInitialEquationInputSchema = TypeNameInput.extend({
  index: z
    .number()
    .int()
    .positive()
    .describe(
      "1-based initial-equation-section index, between 1 and `getInitialEquationCount`.",
    ),
});
export type GetNthInitialEquationInput = z.input<
  typeof GetNthInitialEquationInputSchema
>;

export const GetNthInitialEquationOutputSchema = z.object({
  result: z
    .string()
    .describe(
      "The n-th `initial equation` section as a Modelica source string. Field name `result` is OMC verbatim.",
    ),
});
export type GetNthInitialEquationOutput = z.infer<
  typeof GetNthInitialEquationOutputSchema
>;

export const GetNthInitialEquationDescription =
  "Return the n-th `initial equation` section in a class as a Modelica source string. Pairs with `getInitialEquationCount`.";

export async function getNthInitialEquation(
  ctx: CallContext,
  input: GetNthInitialEquationInput,
): Promise<GetNthInitialEquationOutput> {
  const raw = await ctx.call(
    `getNthInitialEquation(${input.typeName}, ${input.index})`,
  );
  return parseOutput(
    GetNthInitialEquationOutputSchema,
    { result: asString(parse(raw)) ?? "" },
    "getNthInitialEquation",
  );
}
