/**
 * OMC: `function removeComponentModifiers`
 *
 * Strip all modifiers from a component. `keepRedeclares = true` preserves
 * any `redeclare` modifiers (useful when you want to clear values but
 * preserve type substitutions).
 */

import { z } from "zod";

import type { CallContext } from "../../_shared/callContext.js";
import { mlBool } from "../../_shared/format.js";
import { parseOutput } from "../../_shared/parseOutput.js";
import { expectBool, parse } from "../../parse.js";

export const RemoveComponentModifiersInputSchema = z.object({
  typeName: z.string(),
  componentName: z.string(),
  keepRedeclares: z.boolean().optional().default(false),
});
export type RemoveComponentModifiersInput = z.input<
  typeof RemoveComponentModifiersInputSchema
>;

export const RemoveComponentModifiersOutputSchema = z.object({
  success: z.boolean(),
});
export type RemoveComponentModifiersOutput = z.infer<
  typeof RemoveComponentModifiersOutputSchema
>;

export async function removeComponentModifiers(
  ctx: CallContext,
  input: RemoveComponentModifiersInput,
): Promise<RemoveComponentModifiersOutput> {
  const keepRedeclares = input.keepRedeclares ?? false;
  const raw = await ctx.call(
    `removeComponentModifiers(${input.typeName}, ${input.componentName}, ${mlBool(keepRedeclares)})`,
  );
  return parseOutput(
    RemoveComponentModifiersOutputSchema,
    { success: expectBool(parse(raw)) },
    "removeComponentModifiers",
  );
}
