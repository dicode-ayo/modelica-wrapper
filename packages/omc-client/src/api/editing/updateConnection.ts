/**
 * OMC: `function updateConnection`
 *
 * Refresh the annotation for an existing connection (e.g. after a user
 * dragged a waypoint).
 */

import { z } from "zod";

import type { CallContext } from "../../_shared/callContext.js";
import { parseOutput } from "../../_shared/parseOutput.js";
import { expectBool, parse } from "../../parse.js";

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
    { success: expectBool(parse(raw)) },
    "updateConnection",
  );
}
