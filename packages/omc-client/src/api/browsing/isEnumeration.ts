/**
 * OMC: `function isEnumeration`
 *
 * ```modelica
 * function isEnumeration
 *   input TypeName cl;
 *   output Boolean b;
 * end isEnumeration;
 * ```
 */

import { z } from "zod";

import type { CallContext } from "../../_shared/callContext.js";
import { TypeNameInput } from "../../_shared/inputs.js";
import { parseOutput } from "../../_shared/parseOutput.js";
import { expectBool, parse } from "../../parse.js";

export const IsEnumerationInputSchema = TypeNameInput;
export type IsEnumerationInput = z.input<typeof IsEnumerationInputSchema>;

export const IsEnumerationOutputSchema = z.object({
  b: z.boolean(),
});
export type IsEnumerationOutput = z.infer<typeof IsEnumerationOutputSchema>;

export async function isEnumeration(
  ctx: CallContext,
  input: IsEnumerationInput,
): Promise<IsEnumerationOutput> {
  const raw = await ctx.call(`isEnumeration(${input.typeName})`);
  return parseOutput(
    IsEnumerationOutputSchema,
    { b: expectBool(parse(raw)) },
    "isEnumeration",
  );
}
