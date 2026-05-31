/**
 * OMC: `function updateComponent`
 *
 * Updates a component's annotation (typically Placement). Same shape as
 * addComponent — used to move a component on the canvas.
 */

import { z } from "zod";

import type { CallContext } from "../../_shared/callContext.js";
import { SuccessWithDiagnosticOutput } from "../../_shared/outputs.js";
import {
  parseMutationDiagnostic,
  parseOutput,
} from "../../_shared/parseOutput.js";

export const UpdateComponentInputSchema = z.object({
  componentName: z
    .string()
    .describe("Local instance name of the component to update."),
  componentClass: z
    .string()
    .describe(
      "Type of the component (preserved when updating annotation only).",
    ),
  intoTypeName: z.string().describe("Class containing the component."),
  annotation: z
    .string()
    .optional()
    .default("")
    .describe(
      'Raw Modelica `Placement(...)` annotation (no `annotate=` prefix); "" yields the default placement.',
    ),
});
export type UpdateComponentInput = z.input<typeof UpdateComponentInputSchema>;

export const UpdateComponentOutputSchema = SuccessWithDiagnosticOutput;
export type UpdateComponentOutput = z.infer<typeof UpdateComponentOutputSchema>;

export const UpdateComponentDescription =
  "Update a component's declaration in a class (typically to refresh its Placement annotation).";

export async function updateComponent(
  ctx: CallContext,
  input: UpdateComponentInput,
): Promise<UpdateComponentOutput> {
  const annotation = input.annotation ?? "";
  const ann =
    annotation === "" ? "annotate=Placement()" : `annotate=${annotation}`;
  const raw = await ctx.call(
    `updateComponent(${input.componentName}, ${input.componentClass}, ${input.intoTypeName}, ${ann})`,
  );
  return parseOutput(
    UpdateComponentOutputSchema,
    parseMutationDiagnostic(raw),
    "updateComponent",
  );
}
