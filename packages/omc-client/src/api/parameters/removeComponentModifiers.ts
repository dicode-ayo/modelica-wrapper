/**
 * OMC: `function removeComponentModifiers`
 *
 * ```modelica
 * function removeComponentModifiers
 *   input TypeName class_;
 *   input String componentName;
 *   input Boolean keepRedeclares = false;
 *   output Boolean success;
 * end removeComponentModifiers;
 * ```
 *
 * Strip all modifiers from a component. `keepRedeclares = true` preserves
 * any `redeclare` modifiers (useful when you want to clear values but
 * preserve type substitutions).
 *
 * NOTE on argument shape: `componentName` is an OMC `String`, not a
 * TypeName — it MUST be quoted. Passing it unquoted triggers OMC's
 * misleading `Class removeComponentModifiers not found in scope`
 * diagnostic; see `docs/audit.md` §2.10 for the gotcha. This wrapper
 * always quotes it.
 */

import { z } from "zod";

import type { CallContext } from "../../_shared/callContext.js";
import { mlBool, quote } from "../../_shared/format.js";
import { TypeNameAndComponentNameInput } from "../../_shared/inputs.js";
import { SuccessOutput } from "../../_shared/outputs.js";
import { parseOutput } from "../../_shared/parseOutput.js";
import { expectBool, parse } from "../../parse.js";

export const RemoveComponentModifiersInputSchema =
  TypeNameAndComponentNameInput.extend({
    keepRedeclares: z.boolean().optional().default(false).describe("Preserve `redeclare` modifiers (type substitutions) when true."),
  });
export type RemoveComponentModifiersInput = z.input<
  typeof RemoveComponentModifiersInputSchema
>;

export const RemoveComponentModifiersOutputSchema = SuccessOutput;
export type RemoveComponentModifiersOutput = z.infer<
  typeof RemoveComponentModifiersOutputSchema
>;

export const RemoveComponentModifiersDescription =
  "Remove all modifiers from a component, optionally preserving redeclares.";

export async function removeComponentModifiers(
  ctx: CallContext,
  input: RemoveComponentModifiersInput,
): Promise<RemoveComponentModifiersOutput> {
  const keepRedeclares = input.keepRedeclares ?? false;
  const raw = await ctx.call(
    `removeComponentModifiers(${input.typeName}, ${quote(input.componentName)}, ${mlBool(keepRedeclares)})`,
  );
  return parseOutput(
    RemoveComponentModifiersOutputSchema,
    { success: expectBool(parse(raw)) },
    "removeComponentModifiers",
  );
}
