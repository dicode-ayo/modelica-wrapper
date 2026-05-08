/**
 * OMC: `function deleteClass`
 *
 * Remove a class from the symbol table. Does not touch the .mo file on disk.
 */

import { z } from "zod";

import type { CallContext } from "../../_shared/callContext.js";
import { TypeNameInput } from "../../_shared/inputs.js";
import { SuccessOutput } from "../../_shared/outputs.js";
import { parseMutationSuccess, parseOutput } from "../../_shared/parseOutput.js";

export const DeleteClassInputSchema = TypeNameInput;
export type DeleteClassInput = z.input<typeof DeleteClassInputSchema>;

export const DeleteClassOutputSchema = SuccessOutput;
export type DeleteClassOutput = z.infer<typeof DeleteClassOutputSchema>;

export async function deleteClass(
  ctx: CallContext,
  input: DeleteClassInput,
): Promise<DeleteClassOutput> {
  const raw = await ctx.call(`deleteClass(${input.typeName})`);
  return parseOutput(
    DeleteClassOutputSchema,
    { success: await parseMutationSuccess(ctx, raw, "deleteClass") },
    "deleteClass",
  );
}
