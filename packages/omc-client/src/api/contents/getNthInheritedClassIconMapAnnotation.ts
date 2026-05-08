/**
 * OMC: `function getNthInheritedClassIconMapAnnotation`
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
  result: ValueSchema,
});
export type GetNthInheritedClassIconMapAnnotationOutput = z.infer<
  typeof GetNthInheritedClassIconMapAnnotationOutputSchema
>;

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
