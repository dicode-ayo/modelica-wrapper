/**
 * OMC: `function deleteConnection`
 *
 * Remove the connection between `from` and `to` in the given class.
 */

import { z } from "zod";

import type { CallContext } from "../../_shared/callContext.js";
import { SuccessOutput } from "../../_shared/outputs.js";
import { parseOutput } from "../../_shared/parseOutput.js";
import { expectBool, parse } from "../../parse.js";

export const DeleteConnectionInputSchema = z.object({
  from: z.string().describe("Left-hand-side connector reference of the connection to remove."),
  to: z.string().describe("Right-hand-side connector reference of the connection to remove."),
  typeName: z.string().describe("Class containing the connection."),
});
export type DeleteConnectionInput = z.input<typeof DeleteConnectionInputSchema>;

export const DeleteConnectionOutputSchema = SuccessOutput;
export type DeleteConnectionOutput = z.infer<
  typeof DeleteConnectionOutputSchema
>;

export const DeleteConnectionDescription = "Delete a connection in the given class.";

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
