/**
 * OMC: `function getNthConnectionAnnotation`
 *
 * Returns the annotation expression for the n-th connection as a parsed
 * Value (typically a `Line(...)` call or `null`).
 */

import { z } from "zod";

import type { CallContext } from "../../_shared/callContext.js";
import { typeNameOfConnection } from "../../_shared/fields.js";
import { parseOutput } from "../../_shared/parseOutput.js";
import { ValueSchema } from "../../_shared/value.js";
import { parse } from "../../parse.js";

export const GetNthConnectionAnnotationInputSchema = z.object({
  typeName: typeNameOfConnection,
  index: z
    .number()
    .int()
    .positive()
    .describe("1-based connection index, between 1 and `getConnectionCount`."),
});
export type GetNthConnectionAnnotationInput = z.input<
  typeof GetNthConnectionAnnotationInputSchema
>;

export const GetNthConnectionAnnotationOutputSchema = z.object({
  annotation: ValueSchema.describe(
    "Parsed annotation Value tree (typically `Line(...)`); `null` when no annotation is set.",
  ),
});
export type GetNthConnectionAnnotationOutput = z.infer<
  typeof GetNthConnectionAnnotationOutputSchema
>;

export const GetNthConnectionAnnotationDescription =
  "Return the annotation of the n-th `connect` clause in the class.";

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
