/**
 * OMC: `function addConnection`
 *
 * Add a `connect(from, to)` to a class with optional Line annotation.
 */

import { z } from "zod";

import type { CallContext } from "../../_shared/callContext.js";
import { connectionAnnotation } from "../../_shared/fields.js";
import { SuccessWithDiagnosticOutput } from "../../_shared/outputs.js";
import {
  parseMutationDiagnostic,
  parseOutput,
} from "../../_shared/parseOutput.js";

export const AddConnectionInputSchema = z.object({
  from: z
    .string()
    .describe("Left-hand-side connector reference for the new connection."),
  to: z
    .string()
    .describe("Right-hand-side connector reference for the new connection."),
  typeName: z.string().describe("Class to which the connection is added."),
  annotation: connectionAnnotation,
});
export type AddConnectionInput = z.input<typeof AddConnectionInputSchema>;

export const AddConnectionOutputSchema = SuccessWithDiagnosticOutput;
export type AddConnectionOutput = z.infer<typeof AddConnectionOutputSchema>;

export const AddConnectionDescription =
  "Add a `connect(from, to)` to the given class with an optional Line annotation.";

export async function addConnection(
  ctx: CallContext,
  input: AddConnectionInput,
): Promise<AddConnectionOutput> {
  const annotation = input.annotation ?? "";
  const ann = annotation === "" ? "annotate=Line()" : `annotate=${annotation}`;
  const raw = await ctx.call(
    `addConnection(${input.from}, ${input.to}, ${input.typeName}, ${ann})`,
  );
  return parseOutput(
    AddConnectionOutputSchema,
    parseMutationDiagnostic(raw),
    "addConnection",
  );
}
