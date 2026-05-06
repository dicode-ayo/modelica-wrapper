/**
 * OMC: `function createClass`
 *
 * Create a new top-level class. `restriction` is one of "model", "block",
 * "package", "function", "connector", "type", "record", etc.
 *
 * Failure path: returns `false` and stashes a diagnostic in OMC's error buffer
 * — surfaced via `ctx.getErrorString()` in OmcClient.callBool.
 */

import { z } from "zod";

import type { CallContext } from "../../_shared/callContext.js";
import { mlBool, quote } from "../../_shared/format.js";
import { parseMutationSuccess, parseOutput } from "../../_shared/parseOutput.js";

export const CreateClassInputSchema = z.object({
  typeName: z.string(),
  restriction: z.string(),
  partial: z.boolean().optional().default(false),
  encapsulated: z.boolean().optional().default(false),
});
export type CreateClassInput = z.input<typeof CreateClassInputSchema>;

export const CreateClassOutputSchema = z.object({
  success: z.boolean(),
});
export type CreateClassOutput = z.infer<typeof CreateClassOutputSchema>;

export async function createClass(
  ctx: CallContext,
  input: CreateClassInput,
): Promise<CreateClassOutput> {
  const raw = await ctx.call(
    `createClass(${input.typeName}, ${quote(input.restriction)}, ${mlBool(input.partial ?? false)}, ${mlBool(input.encapsulated ?? false)})`,
  );
  return parseOutput(
    CreateClassOutputSchema,
    { success: await parseMutationSuccess(ctx, raw, "createClass") },
    "createClass",
  );
}
