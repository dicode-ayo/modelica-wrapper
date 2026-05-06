/**
 * OMC: `function moveClass`
 *
 * Relocate `cl` to a new parent.
 */

import { z } from "zod";

import type { CallContext } from "../../_shared/callContext.js";
import { parseMutationSuccess, parseOutput } from "../../_shared/parseOutput.js";

export const MoveClassInputSchema = z.object({
  typeName: z.string(),
  newParent: z.string(),
});
export type MoveClassInput = z.input<typeof MoveClassInputSchema>;

export const MoveClassOutputSchema = z.object({
  success: z.boolean(),
});
export type MoveClassOutput = z.infer<typeof MoveClassOutputSchema>;

export async function moveClass(
  ctx: CallContext,
  input: MoveClassInput,
): Promise<MoveClassOutput> {
  const raw = await ctx.call(
    `moveClass(${input.typeName}, ${input.newParent})`,
  );
  return parseOutput(
    MoveClassOutputSchema,
    { success: await parseMutationSuccess(ctx, raw, "moveClass") },
    "moveClass",
  );
}
