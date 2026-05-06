/**
 * OMC: `function getNthConnectorIconAnnotation`
 *
 * ```modelica
 * function getNthConnectorIconAnnotation
 *   input TypeName className;
 *   input Integer n;
 *   output Expression result;
 * end getNthConnectorIconAnnotation;
 * ```
 */

import { z } from "zod";

import type { CallContext } from "../../_shared/callContext.js";
import { parseOutput } from "../../_shared/parseOutput.js";
import { ValueSchema } from "../../_shared/value.js";
import { parse } from "../../parse.js";

export const GetNthConnectorIconAnnotationInputSchema = z.object({
  typeName: z.string(),
  n: z.number().int().positive(),
});
export type GetNthConnectorIconAnnotationInput = z.input<
  typeof GetNthConnectorIconAnnotationInputSchema
>;

export const GetNthConnectorIconAnnotationOutputSchema = z.object({
  result: ValueSchema,
});
export type GetNthConnectorIconAnnotationOutput = z.infer<
  typeof GetNthConnectorIconAnnotationOutputSchema
>;

export async function getNthConnectorIconAnnotation(
  ctx: CallContext,
  input: GetNthConnectorIconAnnotationInput,
): Promise<GetNthConnectorIconAnnotationOutput> {
  const raw = await ctx.call(
    `getNthConnectorIconAnnotation(${input.typeName}, ${input.n})`,
  );
  return parseOutput(
    GetNthConnectorIconAnnotationOutputSchema,
    { result: parse(raw) },
    "getNthConnectorIconAnnotation",
  );
}
