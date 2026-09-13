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
import { TypeNameInput } from "../../_shared/inputs.js";
import { parseOutput } from "../../_shared/parseOutput.js";
import { asString, parse } from "../../parse.js";

export const GetElementAnnotationInputSchema = TypeNameInput;
export type GetElementAnnotationInput = z.input<
  typeof GetElementAnnotationInputSchema
>;

export const GetElementAnnotationOutputSchema = z.object({
  annotationString: z
    .string()
    .describe(
      "Element annotation as a Modelica source fragment; empty if none.",
    ),
});
export type GetElementAnnotationOutput = z.infer<
  typeof GetElementAnnotationOutputSchema
>;

export const GetElementAnnotationDescription =
  "Return the annotation literal (as a Modelica source fragment) for a single element identified by its dotted name.";

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
