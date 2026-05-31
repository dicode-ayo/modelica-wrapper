/**
 * OMC: `function addInitialState`
 *
 * ```modelica
 * function addInitialState
 *   input TypeName cl;
 *   input String state;
 *   input ExpandableConnectorAnnotation annotate;
 *   output Boolean bool;
 * end addInitialState;
 * ```
 *
 * Marks a state as an initial state of the state machine in `cl`. The
 * `annotation` argument carries the placement metadata.
 *
 * NOTE on argument shape: OMC's interactive scripting expects `state` as a
 * Modelica **String** literal (quoted), NOT a bare identifier. Passing the
 * state name unquoted produces a misleading
 * `Class addInitialState not found in scope` diagnostic — OMC fails the
 * ident lookup on the argument and then mis-attributes the failure to the
 * function name. This wrapper always quotes the state.
 */

import { z } from "zod";

import type { CallContext } from "../../_shared/callContext.js";
import { quote } from "../../_shared/format.js";
import { SuccessOutput } from "../../_shared/outputs.js";
import { parseOutput } from "../../_shared/parseOutput.js";
import { expectBool, parse } from "../../parse.js";

export const AddInitialStateInputSchema = z.object({
  typeName: z.string().describe("Class containing the state machine."),
  state: z.string().describe("Name of the state to mark as initial."),
  annotation: z
    .string()
    .optional()
    .default("")
    .describe(
      'Raw Modelica annotation expression (no `annotate=` prefix); "" yields `Placement()`.',
    ),
});
export type AddInitialStateInput = z.input<typeof AddInitialStateInputSchema>;

export const AddInitialStateOutputSchema = SuccessOutput;
export type AddInitialStateOutput = z.infer<typeof AddInitialStateOutputSchema>;

export const AddInitialStateDescription =
  "Mark a state as an initial state of the state machine in the given class.";

export async function addInitialState(
  ctx: CallContext,
  input: AddInitialStateInput,
): Promise<AddInitialStateOutput> {
  const annotation = input.annotation ?? "";
  const ann =
    annotation === "" ? "annotate=Placement()" : `annotate=${annotation}`;
  const raw = await ctx.call(
    `addInitialState(${input.typeName}, ${quote(input.state)}, ${ann})`,
  );
  return parseOutput(
    AddInitialStateOutputSchema,
    { success: expectBool(parse(raw)) },
    "addInitialState",
  );
}
