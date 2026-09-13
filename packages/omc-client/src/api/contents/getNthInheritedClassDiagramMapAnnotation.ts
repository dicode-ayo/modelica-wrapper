/**
 * OMC: `function getNthInheritedClassDiagramMapAnnotation`
 *
 * Returns the diagram-map annotation of the n-th inherited class as the raw `Value` expression tree.
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
  result: ValueSchema.describe(
    "Inherited class diagram-map annotation as a Modelica expression tree (raw `Value`).",
  ),
});
export type GetNthInheritedClassDiagramMapAnnotationOutput = z.infer<
  typeof GetNthInheritedClassDiagramMapAnnotationOutputSchema
>;

export const GetNthInheritedClassDiagramMapAnnotationDescription =
  "Return the diagram-map annotation of the n-th inherited class as the raw `Value` expression tree.";

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
