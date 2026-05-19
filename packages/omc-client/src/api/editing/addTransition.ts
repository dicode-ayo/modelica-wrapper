/**
 * OMC: `function addTransition`
 *
 * Add a state-machine transition.
 *
 * NOTE on argument shape: `from` and `to` must be passed as Modelica String
 * literals (quoted), NOT bare identifiers. Passing them unquoted produces
 * a misleading `Class addTransition not found in scope` diagnostic — OMC
 * fails the ident lookup on the argument and then mis-attributes the
 * failure to the function name. This wrapper always quotes them.
 */

import { z } from "zod";

import type { CallContext } from "../../_shared/callContext.js";
import { connectionAnnotation } from "../../_shared/fields.js";
import { mlBool, quote } from "../../_shared/format.js";
import { SuccessOutput } from "../../_shared/outputs.js";
import { parseOutput } from "../../_shared/parseOutput.js";
import { expectBool, parse } from "../../parse.js";

export const AddTransitionInputSchema = z.object({
  typeName: z.string().describe("Class containing the state machine."),
  from: z.string().describe("Source state of the new transition."),
  to: z.string().describe("Target state of the new transition."),
  /** Modelica boolean expression (raw). */
  condition: z.string().describe("Raw Modelica boolean expression that fires the transition."),
  immediate: z.boolean().describe("Modelica `immediate` flag on the transition."),
  reset: z.boolean().describe("Modelica `reset` flag on the transition."),
  synchronize: z.boolean().describe("Modelica `synchronize` flag on the transition."),
  priority: z.number().int().describe("Transition priority (lower numbers fire first when conditions overlap)."),
  annotation: connectionAnnotation,
});
export type AddTransitionInput = z.input<typeof AddTransitionInputSchema>;

export const AddTransitionOutputSchema = SuccessOutput;
export type AddTransitionOutput = z.infer<typeof AddTransitionOutputSchema>;

export const AddTransitionDescription =
  "Add a state-machine transition between two states with the given guard, flags, priority, and Line annotation.";

export async function addTransition(
  ctx: CallContext,
  input: AddTransitionInput,
): Promise<AddTransitionOutput> {
  const annotation = input.annotation ?? "";
  const ann = annotation === "" ? "annotate=Line()" : `annotate=${annotation}`;
  const raw = await ctx.call(
    `addTransition(${input.typeName}, ${quote(input.from)}, ${quote(input.to)}, ${quote(input.condition)}, ${mlBool(input.immediate)}, ${mlBool(input.reset)}, ${mlBool(input.synchronize)}, ${input.priority}, ${ann})`,
  );
  return parseOutput(
    AddTransitionOutputSchema,
    { success: expectBool(parse(raw)) },
    "addTransition",
  );
}
