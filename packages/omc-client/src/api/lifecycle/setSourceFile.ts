/**
 * OMC: `function setSourceFile`
 *
 * Tells OMC the file path for `cl` (used after Option-B persistence: backend
 * writes the source itself, then notifies OMC where it lives).
 */

import { z } from "zod";

import type { CallContext } from "../../_shared/callContext.js";
import { quote } from "../../_shared/format.js";
import { parseOutput } from "../../_shared/parseOutput.js";
import { expectBool, parse } from "../../parse.js";

export const SetSourceFileInputSchema = z.object({
  typeName: z.string(),
  fileName: z.string(),
});
export type SetSourceFileInput = z.input<typeof SetSourceFileInputSchema>;

export const SetSourceFileOutputSchema = z.object({
  success: z.boolean(),
});
export type SetSourceFileOutput = z.infer<typeof SetSourceFileOutputSchema>;

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
