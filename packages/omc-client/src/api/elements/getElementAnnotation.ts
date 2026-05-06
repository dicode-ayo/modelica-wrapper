/**
 * OMC: `function getElementAnnotation`
 *
 * ```modelica
 * function getElementAnnotation
 *   input TypeName elementName;
 *   output String annotationString;
 * end getElementAnnotation;
 * ```
 *
 * Returns the annotation literal (as a Modelica source fragment) for a single
 * element identified by its dotted name (e.g. `Foo.bar`).
 */

import { z } from "zod";

import type { CallContext } from "../../_shared/callContext.js";
import { parseOutput } from "../../_shared/parseOutput.js";
import { asString, parse } from "../../parse.js";

export const GetElementAnnotationInputSchema = z.object({
  typeName: z.string(),
});
export type GetElementAnnotationInput = z.input<
  typeof GetElementAnnotationInputSchema
>;

export const GetElementAnnotationOutputSchema = z.object({
  annotationString: z.string(),
});
export type GetElementAnnotationOutput = z.infer<
  typeof GetElementAnnotationOutputSchema
>;

export async function getElementAnnotation(
  ctx: CallContext,
  input: GetElementAnnotationInput,
): Promise<GetElementAnnotationOutput> {
  const raw = await ctx.call(`getElementAnnotation(${input.typeName})`);
  return parseOutput(
    GetElementAnnotationOutputSchema,
    { annotationString: asString(parse(raw)) ?? "" },
    "getElementAnnotation",
  );
}
