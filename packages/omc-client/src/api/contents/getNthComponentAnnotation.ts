/**
 * OMC: `function getNthComponentAnnotation`
 *
 * Returns the annotation of the n-th component in a class, as a Modelica
 * expression tree.
 *
 * ```modelica
 * function getNthComponentAnnotation
 *   input TypeName className;
 *   input Integer n;
 *   output Expression result;
 * end getNthComponentAnnotation;
 * ```
 *
 * `result` is returned as the raw `Value` tree (per audit.md §2.4 for
 * `Expression` outputs). `n` is 1-based, in `1..getComponentCount`.
 */

import { z } from "zod";

import type { CallContext } from "../../_shared/callContext.js";
import { TypeNameInput } from "../../_shared/inputs.js";
import { parseOutput } from "../../_shared/parseOutput.js";
import { ValueSchema } from "../../_shared/value.js";
import { parse } from "../../parse.js";

export const GetNthComponentAnnotationInputSchema = TypeNameInput.extend({
  n: z
    .number()
    .int()
    .positive()
    .describe("1-based component index, between 1 and `getComponentCount`."),
});
export type GetNthComponentAnnotationInput = z.input<
  typeof GetNthComponentAnnotationInputSchema
>;

export const GetNthComponentAnnotationOutputSchema = z.object({
  result: ValueSchema.describe(
    "Annotation of the n-th component as a Modelica expression tree (raw `Value`).",
  ),
});
export type GetNthComponentAnnotationOutput = z.infer<
  typeof GetNthComponentAnnotationOutputSchema
>;

export const GetNthComponentAnnotationDescription =
  "Return the annotation of the n-th component in a class as a Modelica expression tree. Pairs with `getComponentCount`.";

export async function getNthComponentAnnotation(
  ctx: CallContext,
  input: GetNthComponentAnnotationInput,
): Promise<GetNthComponentAnnotationOutput> {
  const raw = await ctx.call(
    `getNthComponentAnnotation(${input.typeName}, ${input.n})`,
  );
  return parseOutput(
    GetNthComponentAnnotationOutputSchema,
    { result: parse(raw) },
    "getNthComponentAnnotation",
  );
}
