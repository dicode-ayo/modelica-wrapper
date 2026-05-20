/**
 * OMC: `function getNthAnnotationString`
 *
 * Returns the n-th class-level annotation section as a Modelica source string.
 *
 * ```modelica
 * function getNthAnnotationString
 *   input TypeName class_;
 *   input Integer index;
 *   output String result;
 * end getNthAnnotationString;
 * ```
 *
 * `index` is 1-based, in `1..getAnnotationCount`.
 */

import { z } from "zod";

import type { CallContext } from "../../_shared/callContext.js";
import { TypeNameInput } from "../../_shared/inputs.js";
import { parseOutput } from "../../_shared/parseOutput.js";
import { asString, parse } from "../../parse.js";

export const GetNthAnnotationStringInputSchema = TypeNameInput.extend({
  index: z
    .number()
    .int()
    .positive()
    .describe("1-based annotation index, between 1 and `getAnnotationCount`."),
});
export type GetNthAnnotationStringInput = z.input<
  typeof GetNthAnnotationStringInputSchema
>;

export const GetNthAnnotationStringOutputSchema = z.object({
  result: z
    .string()
    .describe("The n-th class-level annotation section as a Modelica source string. Field name `result` is OMC verbatim."),
});
export type GetNthAnnotationStringOutput = z.infer<
  typeof GetNthAnnotationStringOutputSchema
>;

export const GetNthAnnotationStringDescription =
  "Return the n-th class-level annotation section as a Modelica source string. Pairs with `getAnnotationCount`.";

export async function getNthAnnotationString(
  ctx: CallContext,
  input: GetNthAnnotationStringInput,
): Promise<GetNthAnnotationStringOutput> {
  const raw = await ctx.call(
    `getNthAnnotationString(${input.typeName}, ${input.index})`,
  );
  return parseOutput(
    GetNthAnnotationStringOutputSchema,
    { result: asString(parse(raw)) ?? "" },
    "getNthAnnotationString",
  );
}
