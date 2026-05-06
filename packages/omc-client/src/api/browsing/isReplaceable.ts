/**
 * OMC: `function isReplaceable`
 *
 * ```modelica
 * function isReplaceable
 *   input TypeName element;
 *   output Boolean b;
 * end isReplaceable;
 * ```
 */

import { z } from "zod";

import type { CallContext } from "../../_shared/callContext.js";
import { TypeNameInput } from "../../_shared/inputs.js";
import { parseOutput } from "../../_shared/parseOutput.js";
import { expectBool, parse } from "../../parse.js";

export const IsReplaceableInputSchema = TypeNameInput;
export type IsReplaceableInput = z.input<typeof IsReplaceableInputSchema>;

export const IsReplaceableOutputSchema = z.object({
  b: z.boolean(),
});
export type IsReplaceableOutput = z.infer<typeof IsReplaceableOutputSchema>;

export async function isReplaceable(
  ctx: CallContext,
  input: IsReplaceableInput,
): Promise<IsReplaceableOutput> {
  const raw = await ctx.call(`isReplaceable(${input.typeName})`);
  return parseOutput(
    IsReplaceableOutputSchema,
    { b: expectBool(parse(raw)) },
    "isReplaceable",
  );
}
