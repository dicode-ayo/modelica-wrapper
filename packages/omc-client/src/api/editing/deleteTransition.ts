/**
 * OMC: `function deleteTransition`
 *
 * Remove a state-machine transition. Caller must supply the same identifying
 * fields (from, to, condition, flags, priority) as when it was added.
 */

import { z } from "zod";

import type { CallContext } from "../../_shared/callContext.js";
import { mlBool, quote } from "../../_shared/format.js";
import { SuccessOutput } from "../../_shared/outputs.js";
import { parseOutput } from "../../_shared/parseOutput.js";
import { expectBool, parse } from "../../parse.js";

export const DeleteTransitionInputSchema = z.object({
  typeName: z.string(),
  from: z.string(),
  to: z.string(),
  condition: z.string(),
  immediate: z.boolean(),
  reset: z.boolean(),
  synchronize: z.boolean(),
  priority: z.number().int(),
});
export type DeleteTransitionInput = z.input<typeof DeleteTransitionInputSchema>;

export const DeleteTransitionOutputSchema = SuccessOutput;
export type DeleteTransitionOutput = z.infer<
  typeof DeleteTransitionOutputSchema
>;

export async function deleteTransition(
  ctx: CallContext,
  input: DeleteTransitionInput,
): Promise<DeleteTransitionOutput> {
  const raw = await ctx.call(
    `deleteTransition(${input.typeName}, ${input.from}, ${input.to}, ${quote(input.condition)}, ${mlBool(input.immediate)}, ${mlBool(input.reset)}, ${mlBool(input.synchronize)}, ${input.priority})`,
  );
  return parseOutput(
    DeleteTransitionOutputSchema,
    { success: expectBool(parse(raw)) },
    "deleteTransition",
  );
}
