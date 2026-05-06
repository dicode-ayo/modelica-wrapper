/**
 * OMC: `function renameClass`
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
  typeName: z.string(),
  newName: z.string(),
});
export type RenameClassInput = z.input<typeof RenameClassInputSchema>;

export const RenameClassOutputSchema = z.object({
  result: z.array(z.string()),
});
export type RenameClassOutput = z.infer<typeof RenameClassOutputSchema>;

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
