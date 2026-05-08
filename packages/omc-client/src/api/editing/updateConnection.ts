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
import { SuccessOutput } from "../../_shared/outputs.js";
import { parseMutationSuccess, parseOutput } from "../../_shared/parseOutput.js";

export const UpdateConnectionInputSchema = z.object({
  from: z.string().describe("Left-hand-side connector reference for the connection to update."),
  to: z.string().describe("Right-hand-side connector reference for the connection to update."),
  typeName: z.string().describe("Class containing the connection."),
  annotation: z.string().optional().default("").describe('Raw Modelica `Line(...)` annotation (no `annotate=` prefix); "" yields the default Line.'),
});
export type UpdateConnectionInput = z.input<typeof UpdateConnectionInputSchema>;

export const UpdateConnectionOutputSchema = SuccessOutput;
export type UpdateConnectionOutput = z.infer<
  typeof UpdateConnectionOutputSchema
>;

export const UpdateConnectionDescription =
  "Update the annotation on an existing connection. (Symbol absent on OMC 1.26.x — see file docstring for migration.)";

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
