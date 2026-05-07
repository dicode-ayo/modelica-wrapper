/**
 * OMC: `function removeComponentModifiers`
 *
 * Strip all modifiers from a component. `keepRedeclares = true` preserves
 * any `redeclare` modifiers (useful when you want to clear values but
 * preserve type substitutions).
 *
 * @deprecated NOT AVAILABLE on OMC 1.26.x's interactive scripting (symbol
 *             not found; verified absent on both 1.26.1 and 1.26.7,
 *             despite a public docs page existing for it). Wrapper kept
 *             for forward/backward compatibility.
 *             **Migration on 1.26.x**: enumerate modifiers with
 *             `getComponentModifierNames` then clear each individually with
 *             `setComponentModifierValue({..., expr: ""})`.
 */

import { z } from "zod";

import type { CallContext } from "../../_shared/callContext.js";
import { mlBool } from "../../_shared/format.js";
import { TypeNameAndComponentNameInput } from "../../_shared/inputs.js";
import { SuccessOutput } from "../../_shared/outputs.js";
import { parseMutationSuccess, parseOutput } from "../../_shared/parseOutput.js";

export const RemoveComponentModifiersInputSchema =
  TypeNameAndComponentNameInput.extend({
    keepRedeclares: z.boolean().optional().default(false),
  });
export type RemoveComponentModifiersInput = z.input<
  typeof RemoveComponentModifiersInputSchema
>;

export const RemoveComponentModifiersOutputSchema = SuccessOutput;
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
    { success: await parseMutationSuccess(ctx, raw, "removeComponentModifiers") },
    "removeComponentModifiers",
  );
}
