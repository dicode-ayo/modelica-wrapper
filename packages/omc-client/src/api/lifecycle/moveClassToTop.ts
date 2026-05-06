/**
 * OMC: `function moveClassToTop`
 *
 * Move `cl` to the top of its enclosing package.
 */

import { z } from "zod";

import type { CallContext } from "../../_shared/callContext.js";
import { TypeNameInput } from "../../_shared/inputs.js";
import { parseOutput } from "../../_shared/parseOutput.js";
import { expectBool, parse } from "../../parse.js";

export const MoveClassToTopInputSchema = TypeNameInput;
export type MoveClassToTopInput = z.input<typeof MoveClassToTopInputSchema>;

export const MoveClassToTopOutputSchema = z.object({
  success: z.boolean(),
});
export type MoveClassToTopOutput = z.infer<typeof MoveClassToTopOutputSchema>;

export async function moveClassToTop(
  ctx: CallContext,
  input: MoveClassToTopInput,
): Promise<MoveClassToTopOutput> {
  const raw = await ctx.call(`moveClassToTop(${input.typeName})`);
  return parseOutput(
    MoveClassToTopOutputSchema,
    { success: expectBool(parse(raw)) },
    "moveClassToTop",
  );
}
