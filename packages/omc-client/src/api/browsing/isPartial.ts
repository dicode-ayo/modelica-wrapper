/**
 * OMC: `function isPartial`
 *
 * ```modelica
 * function isPartial
 *   input TypeName cl;
 *   output Boolean b;
 * end isPartial;
 * ```
 */

import { z } from "zod";

import type { CallContext } from "../../_shared/callContext.js";
import { TypeNameInput } from "../../_shared/inputs.js";
import { parseOutput } from "../../_shared/parseOutput.js";
import { expectBool, parse } from "../../parse.js";

export const IsPartialInputSchema = TypeNameInput;
export type IsPartialInput = z.input<typeof IsPartialInputSchema>;

export const IsPartialOutputSchema = z.object({
  b: z.boolean(),
});
export type IsPartialOutput = z.infer<typeof IsPartialOutputSchema>;

export async function isPartial(
  ctx: CallContext,
  input: IsPartialInput,
): Promise<IsPartialOutput> {
  const raw = await ctx.call(`isPartial(${input.typeName})`);
  return parseOutput(
    IsPartialOutputSchema,
    { b: expectBool(parse(raw)) },
    "isPartial",
  );
}
