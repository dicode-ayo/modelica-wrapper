/**
 * OMC: `function updateTransition`
 *
 * ```modelica
 * function updateTransition
 *   input TypeName cl;
 *   input String from;
 *   input String to;
 *   input String oldCondition;
 *   input Boolean oldImmediate;
 *   input Boolean oldReset;
 *   input Boolean oldSynchronize;
 *   input Integer oldPriority;
 *   input String newCondition;
 *   input Boolean newImmediate;
 *   input Boolean newReset;
 *   input Boolean newSynchronize;
 *   input Integer newPriority;
 *   input ExpressionOrModification annotate;
 *   output Boolean bool;
 * end updateTransition;
 * ```
 *
 * Replace an existing state-machine transition's guard expression, flags,
 * priority, and/or placement annotation. Caller supplies BOTH the
 * old-identifier tuple (used to locate the row) and the new values to
 * install. `from` and `to` are not editable through this call — rename
 * the underlying states instead.
 *
 * NOTE on argument shape: `from`, `to`, `oldCondition`, `newCondition` are
 * OMC `String`s and MUST be quoted. Passing them as bare idents produces
 * the misleading "Class updateTransition not found in scope" diagnostic
 * (same gotcha as `addTransition` / `deleteTransition`); see
 * `docs/audit.md` §2.10.
 */

import { z } from "zod";

import type { CallContext } from "../../_shared/callContext.js";
import { connectionAnnotation } from "../../_shared/fields.js";
import { mlBool, quote } from "../../_shared/format.js";
import { SuccessOutput } from "../../_shared/outputs.js";
import { parseOutput } from "../../_shared/parseOutput.js";
import { expectBool, parse } from "../../parse.js";

export const UpdateTransitionInputSchema = z.object({
  typeName: z.string().describe("Class containing the state machine."),
  from: z
    .string()
    .describe(
      "Source state of the transition to update (unchanged by this call).",
    ),
  to: z
    .string()
    .describe(
      "Target state of the transition to update (unchanged by this call).",
    ),
  oldCondition: z
    .string()
    .describe("Existing Modelica boolean guard, used to identify the row."),
  oldImmediate: z
    .boolean()
    .describe("Existing `immediate` flag, used to identify the row."),
  oldReset: z
    .boolean()
    .describe("Existing `reset` flag, used to identify the row."),
  oldSynchronize: z
    .boolean()
    .describe("Existing `synchronize` flag, used to identify the row."),
  oldPriority: z
    .number()
    .int()
    .describe("Existing priority value, used to identify the row."),
  newCondition: z
    .string()
    .describe("New Modelica boolean guard expression to install."),
  newImmediate: z.boolean().describe("New `immediate` flag value."),
  newReset: z.boolean().describe("New `reset` flag value."),
  newSynchronize: z.boolean().describe("New `synchronize` flag value."),
  newPriority: z.number().int().describe("New priority value."),
  annotation: connectionAnnotation,
});
export type UpdateTransitionInput = z.input<typeof UpdateTransitionInputSchema>;

export const UpdateTransitionOutputSchema = SuccessOutput;
export type UpdateTransitionOutput = z.infer<
  typeof UpdateTransitionOutputSchema
>;

export const UpdateTransitionDescription =
  "Update an existing state-machine transition's guard, flags, priority, and/or Line annotation; caller supplies the old identifiers used to locate the row.";

export async function updateTransition(
  ctx: CallContext,
  input: UpdateTransitionInput,
): Promise<UpdateTransitionOutput> {
  const annotation = input.annotation ?? "";
  const ann = annotation === "" ? "annotate=Line()" : `annotate=${annotation}`;
  const raw = await ctx.call(
    `updateTransition(${input.typeName}, ${quote(input.from)}, ${quote(input.to)}, ${quote(input.oldCondition)}, ${mlBool(input.oldImmediate)}, ${mlBool(input.oldReset)}, ${mlBool(input.oldSynchronize)}, ${input.oldPriority}, ${quote(input.newCondition)}, ${mlBool(input.newImmediate)}, ${mlBool(input.newReset)}, ${mlBool(input.newSynchronize)}, ${input.newPriority}, ${ann})`,
  );
  return parseOutput(
    UpdateTransitionOutputSchema,
    { success: expectBool(parse(raw)) },
    "updateTransition",
  );
}
