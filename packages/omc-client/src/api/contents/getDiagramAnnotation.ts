/**
 * OMC: `function getDiagramAnnotation`
 *
 * Same shape as `getIconAnnotation` but for the diagram layer.
 */

import { z } from "zod";

import type { CallContext } from "../../_shared/callContext.js";
import { TypeNameInput } from "../../_shared/inputs.js";
import { parseOutput } from "../../_shared/parseOutput.js";
import { ValueSchema } from "../../_shared/value.js";
import { parse } from "../../parse.js";

export const GetDiagramAnnotationInputSchema = TypeNameInput;
export type GetDiagramAnnotationInput = z.input<
  typeof GetDiagramAnnotationInputSchema
>;

export const GetDiagramAnnotationOutputSchema = z.object({
  annotation: ValueSchema.describe("Parsed Diagram annotation Value tree (CoordinateSystem + graphics list)."),
});
export type GetDiagramAnnotationOutput = z.infer<
  typeof GetDiagramAnnotationOutputSchema
>;

export const GetDiagramAnnotationDescription = "Return the Diagram annotation for a given class as a parsed Value tree.";

export async function getDiagramAnnotation(
  ctx: CallContext,
  input: GetDiagramAnnotationInput,
): Promise<GetDiagramAnnotationOutput> {
  const raw = await ctx.call(`getDiagramAnnotation(${input.typeName})`);
  return parseOutput(
    GetDiagramAnnotationOutputSchema,
    { annotation: parse(raw) },
    "getDiagramAnnotation",
  );
}
