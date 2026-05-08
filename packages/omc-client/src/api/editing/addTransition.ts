/**
 * OMC: `function addTransition`
 *
 * Add a state-machine transition.
 */

import { z } from "zod";

import type { CallContext } from "../../_shared/callContext.js";
import { mlBool, quote } from "../../_shared/format.js";
import { SuccessOutput } from "../../_shared/outputs.js";
import { parseOutput } from "../../_shared/parseOutput.js";
import { expectBool, parse } from "../../parse.js";

export const AddTransitionInputSchema = z.object({
  typeName: z.string(),
  from: z.string(),
  to: z.string(),
  /** Modelica boolean expression (raw). */
  condition: z.string(),
  immediate: z.boolean(),
  reset: z.boolean(),
  synchronize: z.boolean(),
  priority: z.number().int(),
  annotation: z.string().optional().default(""),
});
export type AddTransitionInput = z.input<typeof AddTransitionInputSchema>;

export const AddTransitionOutputSchema = SuccessOutput;
export type AddTransitionOutput = z.infer<typeof AddTransitionOutputSchema>;

export async function addTransition(
  ctx: CallContext,
  input: AddTransitionInput,
): Promise<AddTransitionOutput> {
  const annotation = input.annotation ?? "";
  const ann = annotation === "" ? "annotate=Line()" : `annotate=${annotation}`;
  const raw = await ctx.call(
    `addTransition(${input.typeName}, ${input.from}, ${input.to}, ${quote(input.condition)}, ${mlBool(input.immediate)}, ${mlBool(input.reset)}, ${mlBool(input.synchronize)}, ${input.priority}, ${ann})`,
  );
  return parseOutput(
    AddTransitionOutputSchema,
    { success: expectBool(parse(raw)) },
    "addTransition",
  );
}
