/**
 * OMC: `function getAnnotationCount`
 *
 * Counts the number of class-level annotation sections in a class.
 *
 * ```modelica
 * function getAnnotationCount
 *   input TypeName class_;
 *   output Integer count;
 * end getAnnotationCount;
 * ```
 *
 * Pairs with `getNthAnnotationString(typeName, index)` for 1-based iteration.
 */

import { z } from "zod";

import type { CallContext } from "../../_shared/callContext.js";
import { TypeNameInput } from "../../_shared/inputs.js";
import { parseOutput } from "../../_shared/parseOutput.js";
import { expectInt, parse } from "../../parse.js";

export const GetAnnotationCountInputSchema = TypeNameInput;
export type GetAnnotationCountInput = z.input<
  typeof GetAnnotationCountInputSchema
>;

export const GetAnnotationCountOutputSchema = z.object({
  count: z.number().int().describe("Number of class-level annotation sections in the class."),
});
export type GetAnnotationCountOutput = z.infer<
  typeof GetAnnotationCountOutputSchema
>;

export const GetAnnotationCountDescription =
  "Count the number of class-level annotation sections in a class. Pairs with `getNthAnnotationString`.";

export async function getAnnotationCount(
  ctx: CallContext,
  input: GetAnnotationCountInput,
): Promise<GetAnnotationCountOutput> {
  const raw = await ctx.call(`getAnnotationCount(${input.typeName})`);
  return parseOutput(
    GetAnnotationCountOutputSchema,
    { count: expectInt(parse(raw)) },
    "getAnnotationCount",
  );
}
