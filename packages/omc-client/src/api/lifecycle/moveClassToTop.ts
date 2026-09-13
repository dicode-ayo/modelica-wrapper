/**
 * OMC: `function moveClassToTop`
 *
 * Move `cl` to the top of its enclosing package.
 *
 * Verified working on OMC 1.26.x via the drift probe (both 1.26.1 and
 * 1.26.7) — note the asymmetry with the relocate-to-different-parent
 * `moveClass`, which is missing across the 1.26 line. The two reorderers
 * (`moveClassToTop` / `moveClassToBottom`) exist; only the cross-package
 * relocate is gone.
 */

import { z } from "zod";

import type { CallContext } from "../../_shared/callContext.js";
import { TypeNameInput } from "../../_shared/inputs.js";
import { SuccessOutput } from "../../_shared/outputs.js";
import {
  parseMutationSuccess,
  parseOutput,
} from "../../_shared/parseOutput.js";

export const MoveClassToTopInputSchema = TypeNameInput;
export type MoveClassToTopInput = z.input<typeof MoveClassToTopInputSchema>;

export const MoveClassToTopOutputSchema = SuccessOutput;
export type MoveClassToTopOutput = z.infer<typeof MoveClassToTopOutputSchema>;

export const MoveClassToTopDescription =
  "Move a class to the top of its enclosing class.";

export async function moveClassToTop(
  ctx: CallContext,
  input: MoveClassToTopInput,
): Promise<MoveClassToTopOutput> {
  const raw = await ctx.call(`moveClassToTop(${input.typeName})`);
  return parseOutput(
    MoveClassToTopOutputSchema,
    { success: await parseMutationSuccess(ctx, raw, "moveClassToTop") },
    "moveClassToTop",
  );
}
