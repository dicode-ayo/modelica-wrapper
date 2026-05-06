/**
 * OMC: `function moveClassToBottom`
 *
 * Move `cl` to the bottom of its enclosing package.
 */

import { z } from "zod";

import type { CallContext } from "../../_shared/callContext.js";
import { TypeNameInput } from "../../_shared/inputs.js";
import { parseOutput } from "../../_shared/parseOutput.js";
import { expectBool, parse } from "../../parse.js";

export const MoveClassToBottomInputSchema = TypeNameInput;
export type MoveClassToBottomInput = z.input<
  typeof MoveClassToBottomInputSchema
>;

export const MoveClassToBottomOutputSchema = z.object({
  success: z.boolean(),
});
export type MoveClassToBottomOutput = z.infer<
  typeof MoveClassToBottomOutputSchema
>;

export async function moveClassToBottom(
  ctx: CallContext,
  input: MoveClassToBottomInput,
): Promise<MoveClassToBottomOutput> {
  const raw = await ctx.call(`moveClassToBottom(${input.typeName})`);
  return parseOutput(
    MoveClassToBottomOutputSchema,
    { success: expectBool(parse(raw)) },
    "moveClassToBottom",
  );
}
