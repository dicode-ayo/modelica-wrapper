/**
 * OMC: `function getNthConnectionAnnotation`
 *
 * Returns the annotation expression for the n-th connection as a parsed
 * Value (typically a `Line(...)` call or `null`).
 */

import { z } from "zod";

import type { CallContext } from "../../_shared/callContext.js";
import { parseOutput } from "../../_shared/parseOutput.js";
import { ValueSchema } from "../../_shared/value.js";
import { parse } from "../../parse.js";

export const GetNthConnectionAnnotationInputSchema = z.object({
  typeName: z.string(),
  index: z.number().int().positive(),
});
export type GetNthConnectionAnnotationInput = z.input<
  typeof GetNthConnectionAnnotationInputSchema
>;

export const GetNthConnectionAnnotationOutputSchema = z.object({
  annotation: ValueSchema,
});
export type GetNthConnectionAnnotationOutput = z.infer<
  typeof GetNthConnectionAnnotationOutputSchema
>;

export async function getNthConnectionAnnotation(
  ctx: CallContext,
  input: GetNthConnectionAnnotationInput,
): Promise<GetNthConnectionAnnotationOutput> {
  const raw = await ctx.call(
    `getNthConnectionAnnotation(${input.typeName}, ${input.index})`,
  );
  return parseOutput(
    GetNthConnectionAnnotationOutputSchema,
    { annotation: parse(raw) },
    "getNthConnectionAnnotation",
  );
}
