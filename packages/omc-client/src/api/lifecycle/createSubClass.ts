/**
 * OMC: `function createSubClass`
 *
 * Create a class nested inside `parent`. Same arg shape as createClass plus parent.
 */

import { z } from "zod";

import type { CallContext } from "../../_shared/callContext.js";
import { mlBool, quote } from "../../_shared/format.js";
import { parseMutationSuccess, parseOutput } from "../../_shared/parseOutput.js";

export const CreateSubClassInputSchema = z.object({
  typeName: z.string(),
  parent: z.string(),
  restriction: z.string(),
  partial: z.boolean().optional().default(false),
  encapsulated: z.boolean().optional().default(false),
});
export type CreateSubClassInput = z.input<typeof CreateSubClassInputSchema>;

export const CreateSubClassOutputSchema = z.object({
  success: z.boolean(),
});
export type CreateSubClassOutput = z.infer<typeof CreateSubClassOutputSchema>;

export async function createSubClass(
  ctx: CallContext,
  input: CreateSubClassInput,
): Promise<CreateSubClassOutput> {
  const raw = await ctx.call(
    `createSubClass(${input.typeName}, ${input.parent}, ${quote(input.restriction)}, ${mlBool(input.partial ?? false)}, ${mlBool(input.encapsulated ?? false)})`,
  );
  return parseOutput(
    CreateSubClassOutputSchema,
    { success: await parseMutationSuccess(ctx, raw, "createSubClass") },
    "createSubClass",
  );
}
