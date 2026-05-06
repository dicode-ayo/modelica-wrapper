/**
 * OMC: `function isBlock`
 *
 * ```modelica
 * function isBlock
 *   input TypeName cl;
 *   output Boolean b;
 * end isBlock;
 * ```
 */

import { z } from "zod";

import type { CallContext } from "../../_shared/callContext.js";
import { TypeNameInput } from "../../_shared/inputs.js";
import { parseOutput } from "../../_shared/parseOutput.js";
import { expectBool, parse } from "../../parse.js";

export const IsBlockInputSchema = TypeNameInput;
export type IsBlockInput = z.input<typeof IsBlockInputSchema>;

export const IsBlockOutputSchema = z.object({
  b: z.boolean(),
});
export type IsBlockOutput = z.infer<typeof IsBlockOutputSchema>;

export async function isBlock(
  ctx: CallContext,
  input: IsBlockInput,
): Promise<IsBlockOutput> {
  const raw = await ctx.call(`isBlock(${input.typeName})`);
  return parseOutput(
    IsBlockOutputSchema,
    { b: expectBool(parse(raw)) },
    "isBlock",
  );
}
