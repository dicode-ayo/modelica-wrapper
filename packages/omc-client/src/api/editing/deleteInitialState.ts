/**
 * OMC: `function deleteInitialState`
 *
 * ```modelica
 * function deleteInitialState
 *   input TypeName cl;
 *   input String state;
 *   output Boolean bool;
 * end deleteInitialState;
 * ```
 *
 * Removes the initial-state marker from a state previously marked with
 * `addInitialState`. The state itself is not deleted — only its initial
 * designation.
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

export const DeleteInitialStateInputSchema = z.object({
  typeName: z.string().describe("Class containing the state machine."),
  state: z
    .string()
    .describe("Name of the state to clear the initial marker from."),
});
export type DeleteInitialStateInput = z.input<
  typeof DeleteInitialStateInputSchema
>;

export const DeleteInitialStateOutputSchema = SuccessOutput;
export type DeleteInitialStateOutput = z.infer<
  typeof DeleteInitialStateOutputSchema
>;

export const DeleteInitialStateDescription =
  "Remove the initial-state designation from a state in the given class (the state itself is preserved).";

export async function deleteInitialState(
  ctx: CallContext,
  input: DeleteInitialStateInput,
): Promise<DeleteInitialStateOutput> {
  const raw = await ctx.call(
    `deleteInitialState(${input.typeName}, ${quote(input.state)})`,
  );
  return parseOutput(
    DeleteInitialStateOutputSchema,
    { success: expectBool(parse(raw)) },
    "deleteInitialState",
  );
}
