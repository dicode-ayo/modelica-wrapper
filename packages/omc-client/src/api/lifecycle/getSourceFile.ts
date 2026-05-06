/**
 * OMC: `function getSourceFile`
 *
 * Returns the file path associated with `cl` in OMC's symbol table. May be
 * empty for built-in classes or classes loaded via loadString.
 */

import { z } from "zod";

import type { CallContext } from "../../_shared/callContext.js";
import { TypeNameInput } from "../../_shared/inputs.js";
import { parseOutput } from "../../_shared/parseOutput.js";
import { expectString, parse } from "../../parse.js";

export const GetSourceFileInputSchema = TypeNameInput;
export type GetSourceFileInput = z.input<typeof GetSourceFileInputSchema>;

export const GetSourceFileOutputSchema = z.object({
  fileName: z.string(),
});
export type GetSourceFileOutput = z.infer<typeof GetSourceFileOutputSchema>;

export async function getSourceFile(
  ctx: CallContext,
  input: GetSourceFileInput,
): Promise<GetSourceFileOutput> {
  const raw = await ctx.call(`getSourceFile(${input.typeName})`);
  return parseOutput(
    GetSourceFileOutputSchema,
    { fileName: expectString(parse(raw)) },
    "getSourceFile",
  );
}
