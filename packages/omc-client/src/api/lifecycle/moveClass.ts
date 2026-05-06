/**
 * OMC: `function moveClass`
 *
 * Relocate `cl` to a new parent.
 *
 * @deprecated NOT AVAILABLE on OMC 1.26.x's interactive scripting (symbol
 *             not found; verified absent on both 1.26.1 and 1.26.7,
 *             despite a public docs page existing for it). Wrapper kept
 *             for forward/backward compatibility.
 *             **Migration on 1.26.x**: read the source via `listFile`, edit
 *             the within-clause / nest the class manually, then write it
 *             back via `loadString` (or via Option B persistence).
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
