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
  typeName: z.string(),
  oldName: z.string(),
  newName: z.string(),
});
export type RenameComponentInput = z.input<typeof RenameComponentInputSchema>;

export const RenameComponentOutputSchema = z.object({
  rewrittenDeclarations: z.array(z.string()),
});
export type RenameComponentOutput = z.infer<typeof RenameComponentOutputSchema>;

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
