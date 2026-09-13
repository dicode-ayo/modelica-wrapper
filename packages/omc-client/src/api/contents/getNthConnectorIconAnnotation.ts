/**
 * OMC: `function getNthConnectorIconAnnotation`
 *
 * Returns the icon annotation of the n-th connector of a class as the raw `Value` expression tree.
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
import { TypeNameAndIndexInput } from "../../_shared/inputs.js";
import { parseOutput } from "../../_shared/parseOutput.js";
import { ValueSchema } from "../../_shared/value.js";
import { parse } from "../../parse.js";

export const GetNthConnectorIconAnnotationInputSchema = TypeNameAndIndexInput;
export type GetNthConnectorIconAnnotationInput = z.input<
  typeof GetNthConnectorIconAnnotationInputSchema
>;

export const GetNthConnectorIconAnnotationOutputSchema = z.object({
  result: ValueSchema.describe(
    "Connector icon annotation as a Modelica expression tree (raw `Value`).",
  ),
});
export type GetNthConnectorIconAnnotationOutput = z.infer<
  typeof GetNthConnectorIconAnnotationOutputSchema
>;

export const GetNthConnectorIconAnnotationDescription =
  "Return the icon annotation of the n-th connector of a class as the raw `Value` expression tree.";

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
