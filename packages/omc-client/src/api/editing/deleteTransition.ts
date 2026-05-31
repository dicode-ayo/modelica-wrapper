/**
 * OMC: `function deleteTransition`
 *
 * Remove a state-machine transition. Caller must supply the same identifying
 * fields (from, to, condition, flags, priority) as when it was added.
 *
 * NOTE on argument shape: `from` and `to` must be passed as Modelica String
 * literals (quoted); see the docstring in `addTransition.ts` for the
 * misleading-diagnostic story.
 */

import { z } from "zod";

import type { CallContext } from "../../_shared/callContext.js";
import { mlBool, quote } from "../../_shared/format.js";
import { SuccessOutput } from "../../_shared/outputs.js";
import { parseOutput } from "../../_shared/parseOutput.js";
import { expectBool, parse } from "../../parse.js";

export const DeleteTransitionInputSchema = z.object({
  typeName: z.string().describe("Class containing the state machine."),
  from: z.string().describe("Source state of the transition to remove."),
  to: z.string().describe("Target state of the transition to remove."),
  condition: z
    .string()
    .describe("Raw Modelica boolean expression originally used as the guard."),
  immediate: z
    .boolean()
    .describe("`immediate` flag matching the original transition."),
  reset: z.boolean().describe("`reset` flag matching the original transition."),
  synchronize: z
    .boolean()
    .describe("`synchronize` flag matching the original transition."),
  priority: z
    .number()
    .int()
    .describe("Priority value matching the original transition."),
});
export type DeleteTransitionInput = z.input<typeof DeleteTransitionInputSchema>;

export const DeleteTransitionOutputSchema = SuccessOutput;
export type DeleteTransitionOutput = z.infer<
  typeof DeleteTransitionOutputSchema
>;

export const DeleteTransitionDescription =
  "Delete a transition from a class; caller must supply the same identifying fields used when it was added.";

export async function deleteTransition(
  ctx: CallContext,
  input: DeleteTransitionInput,
): Promise<DeleteTransitionOutput> {
  const raw = await ctx.call(
    `deleteTransition(${input.typeName}, ${quote(input.from)}, ${quote(input.to)}, ${quote(input.condition)}, ${mlBool(input.immediate)}, ${mlBool(input.reset)}, ${mlBool(input.synchronize)}, ${input.priority})`,
  );
  return parseOutput(
    DeleteTransitionOutputSchema,
    { success: expectBool(parse(raw)) },
    "deleteTransition",
  );
}
