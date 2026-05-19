/**
 * OMC: `function moveClass`
 *
 * ```modelica
 * function moveClass
 *   input TypeName className "the class that should be moved";
 *   input Integer offset    "Offset in the class list.";
 *   output Boolean result;
 * end moveClass;
 * ```
 *
 * **In-place reorder within the parent package**: shifts `className` by
 * `offset` positions in its parent's class list. Positive offsets move it
 * down; negative offsets move it up. This is NOT a cross-package
 * relocation — `moveClassToTop` / `moveClassToBottom` are the
 * pin-to-edge variants of the same in-place reorder.
 *
 * NOTE on argument shape: the second arg is an OMC `Integer`, not a
 * TypeName destination. Earlier wrapper versions sent a TypeName, which
 * triggered OMC's misleading "Class moveClass not found in scope"
 * diagnostic; see `docs/audit.md` §2.10 for the gotcha.
 */

import { z } from "zod";

import type { CallContext } from "../../_shared/callContext.js";
import { SuccessOutput } from "../../_shared/outputs.js";
import { parseOutput } from "../../_shared/parseOutput.js";
import { expectBool, parse } from "../../parse.js";

export const MoveClassInputSchema = z.object({
  typeName: z.string().describe("Class to move."),
  offset: z
    .number()
    .int()
    .describe(
      "Signed offset within the parent's class list (positive = down, negative = up).",
    ),
});
export type MoveClassInput = z.input<typeof MoveClassInputSchema>;

export const MoveClassOutputSchema = SuccessOutput;
export type MoveClassOutput = z.infer<typeof MoveClassOutputSchema>;

export const MoveClassDescription =
  "Reorder a class within its parent's class list by a signed integer offset (positive = down, negative = up).";

export async function moveClass(
  ctx: CallContext,
  input: MoveClassInput,
): Promise<MoveClassOutput> {
  const raw = await ctx.call(
    `moveClass(${input.typeName}, ${input.offset})`,
  );
  return parseOutput(
    MoveClassOutputSchema,
    { success: expectBool(parse(raw)) },
    "moveClass",
  );
}
