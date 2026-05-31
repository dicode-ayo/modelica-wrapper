/**
 * OMC: `function getIconAnnotation`
 *
 * Returns the icon-layer annotation as a parsed Value tree. Top-level shape:
 *
 *     {x1, y1, x2, y2, gridVisible, gridX, gridY, initialScale,
 *      {shape1, shape2, ...}}
 *
 * Downstream consumers (annotations parser → typed Shape primitives) walk the
 * value tree.
 */

import { z } from "zod";

import type { CallContext } from "../../_shared/callContext.js";
import { TypeNameInput } from "../../_shared/inputs.js";
import { parseOutput } from "../../_shared/parseOutput.js";
import { ValueSchema } from "../../_shared/value.js";
import { parse } from "../../parse.js";

export const GetIconAnnotationInputSchema = TypeNameInput;
export type GetIconAnnotationInput = z.input<
  typeof GetIconAnnotationInputSchema
>;

export const GetIconAnnotationOutputSchema = z.object({
  annotation: ValueSchema.describe(
    "Parsed Icon annotation Value tree (CoordinateSystem + graphics list).",
  ),
});
export type GetIconAnnotationOutput = z.infer<
  typeof GetIconAnnotationOutputSchema
>;

export const GetIconAnnotationDescription =
  "Return the Icon annotation for a given class as a parsed Value tree.";

export async function getIconAnnotation(
  ctx: CallContext,
  input: GetIconAnnotationInput,
): Promise<GetIconAnnotationOutput> {
  const raw = await ctx.call(`getIconAnnotation(${input.typeName})`);
  return parseOutput(
    GetIconAnnotationOutputSchema,
    { annotation: parse(raw) },
    "getIconAnnotation",
  );
}
