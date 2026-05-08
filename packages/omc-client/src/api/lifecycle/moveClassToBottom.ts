/**
 * OMC: `function moveClassToBottom`
 *
 * Move `cl` to the bottom of its enclosing package.
 *
 * Verified working on OMC 1.26.x via the drift probe (both 1.26.1 and
 * 1.26.7). See `moveClassToTop` for context on why the related `moveClass`
 * (cross-package relocate) is deprecated while the two reorderers work.
 */

import { z } from "zod";

import type { CallContext } from "../../_shared/callContext.js";
import { TypeNameInput } from "../../_shared/inputs.js";
import { SuccessOutput } from "../../_shared/outputs.js";
import { parseMutationSuccess, parseOutput } from "../../_shared/parseOutput.js";

export const MoveClassToBottomInputSchema = TypeNameInput;
export type MoveClassToBottomInput = z.input<
  typeof MoveClassToBottomInputSchema
>;

export const MoveClassToBottomOutputSchema = SuccessOutput;
export type MoveClassToBottomOutput = z.infer<
  typeof MoveClassToBottomOutputSchema
>;

export const MoveClassToBottomDescription = "Move a class to the bottom of its enclosing class.";

export async function moveClassToBottom(
  ctx: CallContext,
  input: MoveClassToBottomInput,
): Promise<MoveClassToBottomOutput> {
  const raw = await ctx.call(`moveClassToBottom(${input.typeName})`);
  return parseOutput(
    MoveClassToBottomOutputSchema,
    { success: await parseMutationSuccess(ctx, raw, "moveClassToBottom") },
    "moveClassToBottom",
  );
}
