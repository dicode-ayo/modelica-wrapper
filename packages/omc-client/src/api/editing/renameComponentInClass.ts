/**
 * OMC: `function renameComponentInClass`
 *
 * ```modelica
 * function renameComponentInClass
 *   input TypeName cl;
 *   input String oldName;
 *   input String newName;
 *   output String[:] result;   -- one entry per rewritten class
 * end renameComponentInClass;
 * ```
 *
 * Rename a component **within a single class** (no cross-class reference
 * rewriting). Use `renameComponent` for the package-wide rename that also
 * updates references in other loaded classes.
 *
 * Despite the OMC docs declaring `output String`, the interactive scripting
 * channel actually returns a list (mirroring `renameComponent`); the
 * wrapper surfaces it as `rewrittenDeclarations` for symmetry.
 */

import { z } from "zod";

import type { CallContext } from "../../_shared/callContext.js";
import { parseOutput } from "../../_shared/parseOutput.js";
import { expectStringList, parse } from "../../parse.js";

export const RenameComponentInClassInputSchema = z.object({
  typeName: z.string().describe("Class containing the component to rename."),
  oldName: z.string().describe("Current local name of the component."),
  newName: z.string().describe("New local name to give the component."),
});
export type RenameComponentInClassInput = z.input<
  typeof RenameComponentInClassInputSchema
>;

export const RenameComponentInClassOutputSchema = z.object({
  rewrittenDeclarations: z
    .array(z.string())
    .describe("Classes whose source was rewritten by the rename."),
});
export type RenameComponentInClassOutput = z.infer<
  typeof RenameComponentInClassOutputSchema
>;

export const RenameComponentInClassDescription =
  "Rename a component within a single class without rewriting cross-class references (use renameComponent for the package-wide rename); returns the list of classes that were modified.";

export async function renameComponentInClass(
  ctx: CallContext,
  input: RenameComponentInClassInput,
): Promise<RenameComponentInClassOutput> {
  const raw = await ctx.call(
    `renameComponentInClass(${input.typeName}, ${input.oldName}, ${input.newName})`,
  );
  return parseOutput(
    RenameComponentInClassOutputSchema,
    { rewrittenDeclarations: expectStringList(parse(raw)) },
    "renameComponentInClass",
  );
}
