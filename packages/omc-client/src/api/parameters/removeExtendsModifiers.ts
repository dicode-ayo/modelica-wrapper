/**
 * OMC: `function removeExtendsModifiers`
 *
 * ```modelica
 * function removeExtendsModifiers
 *   input TypeName className;
 *   input TypeName baseClassName;
 *   input Boolean keepRedeclares := false;
 *   output Boolean bool;
 * end removeExtendsModifiers;
 * ```
 *
 * Strips all modifiers from an `extends` clause. `keepRedeclares = true`
 * preserves `redeclare` modifiers (useful when clearing values while
 * preserving type substitutions).
 */

import { z } from "zod";

import type { CallContext } from "../../_shared/callContext.js";
import {
  extendsBase,
  typeNameOfExtends,
} from "../../_shared/fields.js";
import { mlBool } from "../../_shared/format.js";
import { SuccessOutput } from "../../_shared/outputs.js";
import { parseMutationSuccess, parseOutput } from "../../_shared/parseOutput.js";

export const RemoveExtendsModifiersInputSchema = z.object({
  typeName: typeNameOfExtends,
  extendsBase: extendsBase.describe(
    "TypeName of the base class on the `extends` clause whose modifiers will be cleared.",
  ),
  keepRedeclares: z
    .boolean()
    .optional()
    .default(false)
    .describe("Preserve `redeclare` modifiers (type substitutions) when true."),
});
export type RemoveExtendsModifiersInput = z.input<
  typeof RemoveExtendsModifiersInputSchema
>;

export const RemoveExtendsModifiersOutputSchema = SuccessOutput;
export type RemoveExtendsModifiersOutput = z.infer<
  typeof RemoveExtendsModifiersOutputSchema
>;

export const RemoveExtendsModifiersDescription =
  "Remove all modifiers from an `extends` clause, optionally preserving redeclares.";

export async function removeExtendsModifiers(
  ctx: CallContext,
  input: RemoveExtendsModifiersInput,
): Promise<RemoveExtendsModifiersOutput> {
  const keepRedeclares = input.keepRedeclares ?? false;
  const raw = await ctx.call(
    `removeExtendsModifiers(${input.typeName}, ${input.extendsBase}, ${mlBool(keepRedeclares)})`,
  );
  return parseOutput(
    RemoveExtendsModifiersOutputSchema,
    {
      success: await parseMutationSuccess(ctx, raw, "removeExtendsModifiers"),
    },
    "removeExtendsModifiers",
  );
}
