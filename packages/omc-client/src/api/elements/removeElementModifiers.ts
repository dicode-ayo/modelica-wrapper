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
import { parseMutationSuccess, parseOutput } from "../../_shared/parseOutput.js";

export const RemoveElementModifiersInputSchema = z.object({
  typeName: z.string(),
  componentName: z.string(),
  keepRedeclares: z.boolean().optional().default(false),
});
export type RemoveElementModifiersInput = z.input<
  typeof RemoveElementModifiersInputSchema
>;

export const RemoveElementModifiersOutputSchema = z.object({
  success: z.boolean(),
});
export type RemoveElementModifiersOutput = z.infer<
  typeof RemoveElementModifiersOutputSchema
>;

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
