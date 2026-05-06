/**
 * OMC: `function deleteConnection`
 *
 * Remove the connection between `from` and `to` in the given class.
 */

import { z } from "zod";

import type { CallContext } from "../../_shared/callContext.js";
import { parseOutput } from "../../_shared/parseOutput.js";
import { expectBool, parse } from "../../parse.js";

export const DeleteConnectionInputSchema = z.object({
  from: z.string(),
  to: z.string(),
  typeName: z.string(),
});
export type DeleteConnectionInput = z.input<typeof DeleteConnectionInputSchema>;

export const DeleteConnectionOutputSchema = z.object({
  success: z.boolean(),
});
export type DeleteConnectionOutput = z.infer<
  typeof DeleteConnectionOutputSchema
>;

export async function deleteConnection(
  ctx: CallContext,
  input: DeleteConnectionInput,
): Promise<DeleteConnectionOutput> {
  const raw = await ctx.call(
    `deleteConnection(${input.from}, ${input.to}, ${input.typeName})`,
  );
  return parseOutput(
    DeleteConnectionOutputSchema,
    { success: expectBool(parse(raw)) },
    "deleteConnection",
  );
}
