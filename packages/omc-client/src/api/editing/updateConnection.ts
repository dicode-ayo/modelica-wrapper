/**
 * OMC: `function updateConnection`
 *
 * Refresh the annotation for an existing connection (e.g. after a user
 * dragged a waypoint).
 *
 * @deprecated NOT AVAILABLE on OMC 1.26.x's interactive scripting (symbol
 *             not found; verified absent on both 1.26.1 and 1.26.7,
 *             despite a public docs page existing for it). Wrapper kept
 *             for forward/backward compatibility.
 *             **Migration on 1.26.x**: combine `deleteConnection` +
 *             `addConnection` with the new annotation. Two RPC calls
 *             instead of one, but functionally equivalent.
 */

import { z } from "zod";

import type { CallContext } from "../../_shared/callContext.js";
import { parseMutationSuccess, parseOutput } from "../../_shared/parseOutput.js";

export const UpdateConnectionInputSchema = z.object({
  from: z.string(),
  to: z.string(),
  typeName: z.string(),
  annotation: z.string().optional().default(""),
});
export type UpdateConnectionInput = z.input<typeof UpdateConnectionInputSchema>;

export const UpdateConnectionOutputSchema = z.object({
  success: z.boolean(),
});
export type UpdateConnectionOutput = z.infer<
  typeof UpdateConnectionOutputSchema
>;

export async function updateConnection(
  ctx: CallContext,
  input: UpdateConnectionInput,
): Promise<UpdateConnectionOutput> {
  const annotation = input.annotation ?? "";
  const ann = annotation === "" ? "annotate=Line()" : `annotate=${annotation}`;
  const raw = await ctx.call(
    `updateConnection(${input.from}, ${input.to}, ${input.typeName}, ${ann})`,
  );
  return parseOutput(
    UpdateConnectionOutputSchema,
    { success: await parseMutationSuccess(ctx, raw, "updateConnection") },
    "updateConnection",
  );
}
