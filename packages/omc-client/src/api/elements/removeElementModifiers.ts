/**
 * OMC: `function removeElementModifiers`
 *
 * ```modelica
 * function removeElementModifiers
 *   input TypeName className;
 *   input String componentName;
 *   input Boolean keepRedeclares = false;
 *   output Boolean success;
 * end removeElementModifiers;
 * ```
 *
 * `keepRedeclares = true` preserves any `redeclare` modifiers (clear values
 * but keep type substitutions).
 */

import { z } from "zod";

import type { CallContext } from "../../_shared/callContext.js";
import { mlBool, quote } from "../../_shared/format.js";
import { TypeNameAndComponentNameInput } from "../../_shared/inputs.js";
import { SuccessOutput } from "../../_shared/outputs.js";
import { parseMutationSuccess, parseOutput } from "../../_shared/parseOutput.js";

export const RemoveElementModifiersInputSchema =
  TypeNameAndComponentNameInput.extend({
    keepRedeclares: z.boolean().optional().default(false).describe("Preserve `redeclare` modifiers when true; clear all modifiers when false."),
  });
export type RemoveElementModifiersInput = z.input<
  typeof RemoveElementModifiersInputSchema
>;

export const RemoveElementModifiersOutputSchema = SuccessOutput;
export type RemoveElementModifiersOutput = z.infer<
  typeof RemoveElementModifiersOutputSchema
>;

export const RemoveElementModifiersDescription =
  "Remove the modifiers attached to an element. With `keepRedeclares=true`, preserves any `redeclare` modifiers.";

export async function removeElementModifiers(
  ctx: CallContext,
  input: RemoveElementModifiersInput,
): Promise<RemoveElementModifiersOutput> {
  const keepRedeclares = input.keepRedeclares ?? false;
  const raw = await ctx.call(
    `removeElementModifiers(${input.typeName}, ${quote(input.componentName)}, ${mlBool(keepRedeclares)})`,
  );
  return parseOutput(
    RemoveElementModifiersOutputSchema,
    { success: await parseMutationSuccess(ctx, raw, "removeElementModifiers") },
    "removeElementModifiers",
  );
}
