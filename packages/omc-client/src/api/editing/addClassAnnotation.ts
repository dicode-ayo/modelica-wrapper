/**
 * OMC: `function addClassAnnotation`
 *
 * Attach an annotation to the class itself (not a component). `annotation`
 * is the raw Modelica expression starting after `annotate=`, e.g.
 * `experiment(StopTime=4)` or `Documentation(info="<html>...</html>")`.
 */

import { z } from "zod";

import type { CallContext } from "../../_shared/callContext.js";
import { SuccessOutput } from "../../_shared/outputs.js";
import { parseOutput } from "../../_shared/parseOutput.js";
import { expectBool, parse } from "../../parse.js";

export const AddClassAnnotationInputSchema = z.object({
  typeName: z.string().describe("Class to annotate."),
  annotation: z.string().describe('Raw Modelica annotation expression (no `annotate=` prefix), e.g. `experiment(StopTime=4)`.'),
});
export type AddClassAnnotationInput = z.input<
  typeof AddClassAnnotationInputSchema
>;

export const AddClassAnnotationOutputSchema = SuccessOutput;
export type AddClassAnnotationOutput = z.infer<
  typeof AddClassAnnotationOutputSchema
>;

export const AddClassAnnotationDescription = "Attach an annotation to a class (Diagram, Icon, experiment, Documentation, …).";

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
