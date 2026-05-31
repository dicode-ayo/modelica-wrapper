/**
 * OMC: `function deleteComponent`
 *
 * Remove a component from a class.
 */

import { z } from "zod";

import type { CallContext } from "../../_shared/callContext.js";
import { SuccessWithDiagnosticOutput } from "../../_shared/outputs.js";
import {
  parseMutationDiagnostic,
  parseOutput,
} from "../../_shared/parseOutput.js";

export const DeleteComponentInputSchema = z.object({
  componentName: z
    .string()
    .describe("Local instance name of the component to delete."),
  typeName: z.string().describe("Class containing the component to delete."),
});
export type DeleteComponentInput = z.input<typeof DeleteComponentInputSchema>;

export const DeleteComponentOutputSchema = SuccessWithDiagnosticOutput;
export type DeleteComponentOutput = z.infer<typeof DeleteComponentOutputSchema>;

export const DeleteComponentDescription =
  "Delete a component from the given class.";

export async function deleteComponent(
  ctx: CallContext,
  input: DeleteComponentInput,
): Promise<DeleteComponentOutput> {
  const raw = await ctx.call(
    `deleteComponent(${input.componentName}, ${input.typeName})`,
  );
  return parseOutput(
    DeleteComponentOutputSchema,
    parseMutationDiagnostic(raw),
    "deleteComponent",
  );
}
