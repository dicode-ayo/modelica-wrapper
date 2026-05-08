/**
 * OMC: `function setSourceFile`
 *
 * Tells OMC the file path for `cl` (used after Option-B persistence: backend
 * writes the source itself, then notifies OMC where it lives).
 */

import { z } from "zod";

import type { CallContext } from "../../_shared/callContext.js";
import { quote } from "../../_shared/format.js";
import { SuccessOutput } from "../../_shared/outputs.js";
import { parseOutput } from "../../_shared/parseOutput.js";
import { expectBool, parse } from "../../parse.js";

export const SetSourceFileInputSchema = z.object({
  typeName: z.string().describe("Class whose source filename is being set."),
  fileName: z.string().describe("New source file path to associate with the class in OMC's symbol table."),
});
export type SetSourceFileInput = z.input<typeof SetSourceFileInputSchema>;

export const SetSourceFileOutputSchema = SuccessOutput;
export type SetSourceFileOutput = z.infer<typeof SetSourceFileOutputSchema>;

export const SetSourceFileDescription = "Set the source filename associated with a class in OMC's symbol table.";

export async function setSourceFile(
  ctx: CallContext,
  input: SetSourceFileInput,
): Promise<SetSourceFileOutput> {
  const raw = await ctx.call(
    `setSourceFile(${input.typeName}, ${quote(input.fileName)})`,
  );
  return parseOutput(
    SetSourceFileOutputSchema,
    { success: expectBool(parse(raw)) },
    "setSourceFile",
  );
}
