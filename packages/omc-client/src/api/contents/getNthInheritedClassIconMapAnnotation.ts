/**
 * OMC: `function getNthInheritedClassIconMapAnnotation`
 *
 * Returns the icon-map annotation of the n-th inherited class as the raw `Value` expression tree.
 *
 * ```modelica
 * function getNthInheritedClassIconMapAnnotation
 *   input TypeName className;
 *   input Integer n;
 *   output Expression result;
 * end getNthInheritedClassIconMapAnnotation;
 * ```
 */

import { z } from "zod";

import type { CallContext } from "../../_shared/callContext.js";
import { TypeNameAndIndexInput } from "../../_shared/inputs.js";
import { parseOutput } from "../../_shared/parseOutput.js";
import { ValueSchema } from "../../_shared/value.js";
import { parse } from "../../parse.js";

export const GetNthInheritedClassIconMapAnnotationInputSchema =
  TypeNameAndIndexInput;
export type GetNthInheritedClassIconMapAnnotationInput = z.input<
  typeof GetNthInheritedClassIconMapAnnotationInputSchema
>;

export const GetNthInheritedClassIconMapAnnotationOutputSchema = z.object({
  result: ValueSchema.describe("Inherited class icon-map annotation as a Modelica expression tree (raw `Value`)."),
});
export type GetNthInheritedClassIconMapAnnotationOutput = z.infer<
  typeof GetNthInheritedClassIconMapAnnotationOutputSchema
>;

export const GetNthInheritedClassIconMapAnnotationDescription =
  "Return the icon-map annotation of the n-th inherited class as the raw `Value` expression tree.";

export async function getNthInheritedClassIconMapAnnotation(
  ctx: CallContext,
  input: GetNthInheritedClassIconMapAnnotationInput,
): Promise<GetNthInheritedClassIconMapAnnotationOutput> {
  const raw = await ctx.call(
    `getNthInheritedClassIconMapAnnotation(${input.typeName}, ${input.n})`,
  );
  return parseOutput(
    GetNthInheritedClassIconMapAnnotationOutputSchema,
    { result: parse(raw) },
    "getNthInheritedClassIconMapAnnotation",
  );
}
