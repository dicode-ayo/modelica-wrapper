/**
 * OMC: `function updateConnectionNames`
 *
 * ```modelica
 * function updateConnectionNames
 *   input TypeName className;
 *   input String from;
 *   input String to;
 *   input String fromNew;
 *   input String toNew;
 *   output Boolean result;
 * end updateConnectionNames;
 * ```
 *
 * Rename one or both endpoints of an existing connection (without touching
 * the annotation). Useful when a component is renamed and its incident
 * connections need their endpoint identifiers rewritten.
 *
 * NOTE on argument shape: `from`, `to`, `fromNew`, `toNew` are OMC `String`s
 * — they MUST be quoted. Passing them unquoted produces the misleading
 * "Class updateConnectionNames not found in scope" diagnostic; see
 * `docs/audit.md` §2.10 for the gotcha.
 */

import { z } from "zod";

import type { CallContext } from "../../_shared/callContext.js";
import { typeNameOfConnection } from "../../_shared/fields.js";
import { quote } from "../../_shared/format.js";
import { SuccessWithDiagnosticOutput } from "../../_shared/outputs.js";
import { parseMutationDiagnostic, parseOutput } from "../../_shared/parseOutput.js";

export const UpdateConnectionNamesInputSchema = z.object({
  typeName: typeNameOfConnection,
  from: z
    .string()
    .describe("Current left-hand-side connector reference of the connection."),
  to: z
    .string()
    .describe("Current right-hand-side connector reference of the connection."),
  fromNew: z
    .string()
    .describe("New left-hand-side connector reference to install."),
  toNew: z
    .string()
    .describe("New right-hand-side connector reference to install."),
});
export type UpdateConnectionNamesInput = z.input<
  typeof UpdateConnectionNamesInputSchema
>;

export const UpdateConnectionNamesOutputSchema = SuccessWithDiagnosticOutput;
export type UpdateConnectionNamesOutput = z.infer<
  typeof UpdateConnectionNamesOutputSchema
>;

export const UpdateConnectionNamesDescription =
  "Rename one or both endpoints of an existing connection within a class, leaving its annotation untouched.";

export async function updateConnectionNames(
  ctx: CallContext,
  input: UpdateConnectionNamesInput,
): Promise<UpdateConnectionNamesOutput> {
  const raw = await ctx.call(
    `updateConnectionNames(${input.typeName}, ${quote(input.from)}, ${quote(input.to)}, ${quote(input.fromNew)}, ${quote(input.toNew)})`,
  );
  return parseOutput(
    UpdateConnectionNamesOutputSchema,
    parseMutationDiagnostic(raw),
    "updateConnectionNames",
  );
}
