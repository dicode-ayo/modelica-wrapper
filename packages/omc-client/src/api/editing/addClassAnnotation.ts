/**
 * OMC: `function addClassAnnotation`
 *
 * Attach an annotation to the class itself (not a component). `annotation`
 * is the raw Modelica expression starting after `annotate=`, e.g.
 * `experiment(StopTime=4)` or `Documentation(info="<html>...</html>")`.
 */

import { z } from "zod";

import type { CallContext } from "../../_shared/callContext.js";
import { parseOutput } from "../../_shared/parseOutput.js";
import { expectBool, parse } from "../../parse.js";

export const AddClassAnnotationInputSchema = z.object({
  typeName: z.string(),
  annotation: z.string(),
});
export type AddClassAnnotationInput = z.input<
  typeof AddClassAnnotationInputSchema
>;

export const AddClassAnnotationOutputSchema = z.object({
  success: z.boolean(),
});
export type AddClassAnnotationOutput = z.infer<
  typeof AddClassAnnotationOutputSchema
>;

export async function addClassAnnotation(
  ctx: CallContext,
  input: AddClassAnnotationInput,
): Promise<AddClassAnnotationOutput> {
  const raw = await ctx.call(
    `addClassAnnotation(${input.typeName}, ${input.annotation})`,
  );
  return parseOutput(
    AddClassAnnotationOutputSchema,
    { success: expectBool(parse(raw)) },
    "addClassAnnotation",
  );
}
