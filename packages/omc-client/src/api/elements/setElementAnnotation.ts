/**
 * OMC: `function setElementAnnotation`
 *
 * ```modelica
 * function setElementAnnotation
 *   input TypeName elementName;
 *   input ExpressionOrModification annotationMod;
 *   output Boolean success;
 * end setElementAnnotation;
 * ```
 *
 * `annotationMod` is the raw annotation expression (e.g. `Placement(...)`)
 * wrapped in `$Code(=...)` so OMC doesn't string-escape it.
 */

import { z } from "zod";

import type { CallContext } from "../../_shared/callContext.js";
import { SuccessOutput } from "../../_shared/outputs.js";
import { parseOutput } from "../../_shared/parseOutput.js";
import { expectBool, parse } from "../../parse.js";

export const SetElementAnnotationInputSchema = z.object({
  typeName: z.string().describe("Dotted element name within the class (OMC `elementName`, mapped to `typeName` per the package convention)."),
  annotationMod: z.string().describe("Raw annotation expression (e.g. `Placement(...)`); wrapped in `$Code(=...)` before sending to OMC. Empty clears the annotation."),
});
export type SetElementAnnotationInput = z.input<
  typeof SetElementAnnotationInputSchema
>;

export const SetElementAnnotationOutputSchema = SuccessOutput;
export type SetElementAnnotationOutput = z.infer<
  typeof SetElementAnnotationOutputSchema
>;

export const SetElementAnnotationDescription =
  "Set the annotation on an element. The annotation expression is wrapped in `$Code(=...)` so OMC doesn't string-escape it.";

export async function setElementAnnotation(
  ctx: CallContext,
  input: SetElementAnnotationInput,
): Promise<SetElementAnnotationOutput> {
  const codeArg =
    input.annotationMod === ""
      ? "$Code(=)"
      : `$Code(=${input.annotationMod})`;
  const raw = await ctx.call(
    `setElementAnnotation(${input.typeName}, ${codeArg})`,
  );
  return parseOutput(
    SetElementAnnotationOutputSchema,
    { success: expectBool(parse(raw)) },
    "setElementAnnotation",
  );
}
