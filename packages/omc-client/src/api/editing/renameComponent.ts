/**
 * OMC: `function renameComponent`
 *
 * Rename a component instance and return the rewritten declarations.
 */

import { z } from "zod";

import type { CallContext } from "../../_shared/callContext.js";
import { parseOutput } from "../../_shared/parseOutput.js";
import { expectStringList, parse } from "../../parse.js";

export const RenameComponentInputSchema = z.object({
  typeName: z.string().describe("Class containing the component to rename."),
  oldName: z.string().describe("Current local name of the component."),
  newName: z.string().describe("New local name to give the component."),
});
export type RenameComponentInput = z.input<typeof RenameComponentInputSchema>;

export const RenameComponentOutputSchema = z.object({
  rewrittenDeclarations: z.array(z.string()).describe("Classes whose source was rewritten by the rename."),
});
export type RenameComponentOutput = z.infer<typeof RenameComponentOutputSchema>;

export const RenameComponentDescription =
  "Rename a component and update references to it across the loaded classes; returns the list of classes that were modified.";

export async function renameComponent(
  ctx: CallContext,
  input: RenameComponentInput,
): Promise<RenameComponentOutput> {
  const raw = await ctx.call(
    `renameComponent(${input.typeName}, ${input.oldName}, ${input.newName})`,
  );
  return parseOutput(
    RenameComponentOutputSchema,
    { rewrittenDeclarations: expectStringList(parse(raw)) },
    "renameComponent",
  );
}
