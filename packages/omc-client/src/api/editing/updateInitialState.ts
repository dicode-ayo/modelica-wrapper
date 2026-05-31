/**
 * OMC: `function updateInitialState`
 *
 * ```modelica
 * function updateInitialState
 *   input TypeName cl;
 *   input String state;
 *   input ExpandableConnectorAnnotation annotate;
 *   output Boolean bool;
 * end updateInitialState;
 * ```
 *
 * Replaces the annotation (placement metadata) on an existing initial-state
 * marker. The state must already be marked initial via `addInitialState`.
 *
 * NOTE on argument shape: `state` must be passed as a Modelica String
 * literal (quoted); see the docstring in `addInitialState.ts` for the
 * misleading-diagnostic story.
 */

import { z } from "zod";

import type { CallContext } from "../../_shared/callContext.js";
import { quote } from "../../_shared/format.js";
import { SuccessOutput } from "../../_shared/outputs.js";
import { parseOutput } from "../../_shared/parseOutput.js";
import { expectBool, parse } from "../../parse.js";

export const UpdateInitialStateInputSchema = z.object({
  typeName: z.string().describe("Class containing the state machine."),
  state: z.string().describe("Name of the existing initial state to update."),
  annotation: z
    .string()
    .optional()
    .default("")
    .describe(
      'Raw Modelica annotation expression replacing the current one (no `annotate=` prefix); "" yields `Placement()`.',
    ),
});
export type UpdateInitialStateInput = z.input<
  typeof UpdateInitialStateInputSchema
>;

export const UpdateInitialStateOutputSchema = SuccessOutput;
export type UpdateInitialStateOutput = z.infer<
  typeof UpdateInitialStateOutputSchema
>;

export const UpdateInitialStateDescription =
  "Replace the placement annotation on an existing initial-state marker.";

export async function updateInitialState(
  ctx: CallContext,
  input: UpdateInitialStateInput,
): Promise<UpdateInitialStateOutput> {
  const annotation = input.annotation ?? "";
  const ann =
    annotation === "" ? "annotate=Placement()" : `annotate=${annotation}`;
  const raw = await ctx.call(
    `updateInitialState(${input.typeName}, ${quote(input.state)}, ${ann})`,
  );
  return parseOutput(
    UpdateInitialStateOutputSchema,
    { success: expectBool(parse(raw)) },
    "updateInitialState",
  );
}
