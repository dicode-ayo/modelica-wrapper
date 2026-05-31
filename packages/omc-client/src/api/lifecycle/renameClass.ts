/**
 * OMC: `function renameClass`
 *
 * Renames a class and updates references to it across the loaded classes.
 * Returns the list of classes that were modified by the rename.
 *
 * ```modelica
 * function renameClass
 *   input TypeName oldName "The path of the class to rename.";
 *   input TypeName newName "The new non-qualified name of the class.";
 *   output TypeName[:] result;
 * end renameClass;
 * ```
 *
 * Returns the renamed class names (the rename can affect multiple references).
 */

import { z } from "zod";

import type { CallContext } from "../../_shared/callContext.js";
import { parseOutput } from "../../_shared/parseOutput.js";
import { expectStringList, parse } from "../../parse.js";

export const RenameClassInputSchema = z.object({
  typeName: z
    .string()
    .describe(
      "Path of the class to rename (overrides the generic shared description: this is the OMC `oldName` argument).",
    ),
  newName: z.string().describe("New non-qualified name to give the class."),
});
export type RenameClassInput = z.input<typeof RenameClassInputSchema>;

export const RenameClassOutputSchema = z.object({
  result: z
    .array(z.string())
    .describe(
      "Class names that were modified by the rename (a single rename can touch multiple references).",
    ),
});
export type RenameClassOutput = z.infer<typeof RenameClassOutputSchema>;

export const RenameClassDescription =
  "Rename a class and update references to it across the loaded classes; returns the list of classes that were modified.";

export async function renameClass(
  ctx: CallContext,
  input: RenameClassInput,
): Promise<RenameClassOutput> {
  const raw = await ctx.call(
    `renameClass(${input.typeName}, ${input.newName})`,
  );
  return parseOutput(
    RenameClassOutputSchema,
    { result: expectStringList(parse(raw)) },
    "renameClass",
  );
}
