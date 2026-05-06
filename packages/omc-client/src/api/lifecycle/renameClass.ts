/**
 * OMC: `function renameClass`
 *
 * Rename an existing class. Returns the new fully-qualified name.
 */

import { z } from "zod";

import type { CallContext } from "../../_shared/callContext.js";
import { parseOutput } from "../../_shared/parseOutput.js";
import { expectString, parse } from "../../parse.js";

export const RenameClassInputSchema = z.object({
  typeName: z.string(),
  newName: z.string(),
});
export type RenameClassInput = z.input<typeof RenameClassInputSchema>;

export const RenameClassOutputSchema = z.object({
  newQualifiedName: z.string(),
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
    { newQualifiedName: expectString(parse(raw)) },
    "renameClass",
  );
}
