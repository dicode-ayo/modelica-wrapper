/**
 * OMC: `function getNthInheritedClassDiagramMapAnnotation`
 *
 * ```modelica
 * function getNthInheritedClassDiagramMapAnnotation
 *   input TypeName className;
 *   input Integer n;
 *   output Expression result;
 * end getNthInheritedClassDiagramMapAnnotation;
 * ```
 */

import { z } from "zod";

import type { CallContext } from "../../_shared/callContext.js";
import { TypeNameAndIndexInput } from "../../_shared/inputs.js";
import { parseOutput } from "../../_shared/parseOutput.js";
import { ValueSchema } from "../../_shared/value.js";
import { parse } from "../../parse.js";

export const GetNthInheritedClassDiagramMapAnnotationInputSchema =
  TypeNameAndIndexInput;
export type GetNthInheritedClassDiagramMapAnnotationInput = z.input<
  typeof GetNthInheritedClassDiagramMapAnnotationInputSchema
>;

export const GetNthInheritedClassDiagramMapAnnotationOutputSchema = z.object({
  result: ValueSchema,
});
export type GetNthInheritedClassDiagramMapAnnotationOutput = z.infer<
  typeof GetNthInheritedClassDiagramMapAnnotationOutputSchema
>;

export async function getNthInheritedClassDiagramMapAnnotation(
  ctx: CallContext,
  input: GetNthInheritedClassDiagramMapAnnotationInput,
): Promise<GetNthInheritedClassDiagramMapAnnotationOutput> {
  const raw = await ctx.call(
    `getNthInheritedClassDiagramMapAnnotation(${input.typeName}, ${input.n})`,
  );
  return parseOutput(
    GetNthInheritedClassDiagramMapAnnotationOutputSchema,
    { result: parse(raw) },
    "getNthInheritedClassDiagramMapAnnotation",
  );
}
