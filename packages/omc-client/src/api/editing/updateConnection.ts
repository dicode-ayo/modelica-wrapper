/**
 * OMC: `function updateConnection`
 *
 * ```modelica
 * function updateConnection
 *   input TypeName className;
 *   input String from;
 *   input String to;
 *   input ExpressionOrModification annotate;
 *   output Boolean result;
 * end updateConnection;
 * ```
 *
 * Refresh the annotation for an existing connection (e.g. after a user
 * dragged a waypoint).
 *
 * NOTE on argument shape: `from` and `to` are OMC `String`s — they MUST
 * be quoted. Also: the docs put `className` FIRST, then `from`, `to`,
 * `annotate`. Earlier wrapper versions had the order wrong (from/to
 * before className) and OMC reported the misleading "Class
 * updateConnection not found in scope" diagnostic instead of a clear
 * type/order error; see `docs/audit.md` §2.10 for the gotcha.
 */

import { z } from "zod";

import type { CallContext } from "../../_shared/callContext.js";
import {
  connectionAnnotation,
  typeNameOfConnection,
} from "../../_shared/fields.js";
import { quote } from "../../_shared/format.js";
import { SuccessWithDiagnosticOutput } from "../../_shared/outputs.js";
import {
  parseMutationDiagnostic,
  parseOutput,
} from "../../_shared/parseOutput.js";

export const UpdateConnectionInputSchema = z.object({
  typeName: typeNameOfConnection,
  from: z
    .string()
    .describe(
      "Left-hand-side connector reference for the connection to update.",
    ),
  to: z
    .string()
    .describe(
      "Right-hand-side connector reference for the connection to update.",
    ),
  annotation: connectionAnnotation,
});
export type UpdateConnectionInput = z.input<typeof UpdateConnectionInputSchema>;

export const UpdateConnectionOutputSchema = SuccessWithDiagnosticOutput;
export type UpdateConnectionOutput = z.infer<
  typeof UpdateConnectionOutputSchema
>;

export const UpdateConnectionDescription =
  "Update the annotation on an existing connection.";

export async function updateConnection(
  ctx: CallContext,
  input: UpdateConnectionInput,
): Promise<UpdateConnectionOutput> {
  const annotation = input.annotation ?? "";
  const ann = annotation === "" ? "Line()" : annotation;
  const raw = await ctx.call(
    `updateConnection(${input.typeName}, ${quote(input.from)}, ${quote(input.to)}, ${ann})`,
  );
  return parseOutput(
    UpdateConnectionOutputSchema,
    parseMutationDiagnostic(raw),
    "updateConnection",
  );
}
