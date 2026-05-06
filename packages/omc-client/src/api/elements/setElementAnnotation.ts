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
import { parseOutput } from "../../_shared/parseOutput.js";
import { expectBool, parse } from "../../parse.js";

export const SetElementAnnotationInputSchema = z.object({
  typeName: z.string(),
  annotationMod: z.string(),
});
export type SetElementAnnotationInput = z.input<
  typeof SetElementAnnotationInputSchema
>;

export const SetElementAnnotationOutputSchema = z.object({
  success: z.boolean(),
});
export type SetElementAnnotationOutput = z.infer<
  typeof SetElementAnnotationOutputSchema
>;

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
