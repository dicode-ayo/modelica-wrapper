/**
 * OMC: `function getModelInstanceAnnotation`
 *
 * ```modelica
 * function getModelInstanceAnnotation
 *   input TypeName className;
 *   input String[:] filter = fill("", 0);
 *   input Boolean prettyPrint = false;
 *   output String result;
 * end getModelInstanceAnnotation;
 * ```
 *
 * The result is a JSON document carrying the requested annotations. Wrappers
 * do not parse the JSON; callers `JSON.parse(result)` themselves.
 */

import { z } from "zod";

import type { CallContext } from "../../_shared/callContext.js";
import { mlBool, quoteList } from "../../_shared/format.js";
import { parseOutput } from "../../_shared/parseOutput.js";
import { asString, parse } from "../../parse.js";

export const GetModelInstanceAnnotationInputSchema = z.object({
  typeName: z.string(),
  filter: z.array(z.string()).optional().default([]),
  prettyPrint: z.boolean().optional().default(false),
});
export type GetModelInstanceAnnotationInput = z.input<
  typeof GetModelInstanceAnnotationInputSchema
>;

export const GetModelInstanceAnnotationOutputSchema = z.object({
  result: z.string(),
});
export type GetModelInstanceAnnotationOutput = z.infer<
  typeof GetModelInstanceAnnotationOutputSchema
>;

export async function getModelInstanceAnnotation(
  ctx: CallContext,
  input: GetModelInstanceAnnotationInput,
): Promise<GetModelInstanceAnnotationOutput> {
  const filter = input.filter ?? [];
  const prettyPrint = input.prettyPrint ?? false;
  const raw = await ctx.call(
    `getModelInstanceAnnotation(${input.typeName}, ${quoteList(filter)}, ${mlBool(prettyPrint)})`,
  );
  return parseOutput(
    GetModelInstanceAnnotationOutputSchema,
    { result: asString(parse(raw)) ?? "" },
    "getModelInstanceAnnotation",
  );
}
