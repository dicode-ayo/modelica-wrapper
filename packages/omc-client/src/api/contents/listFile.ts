/**
 * OMC: `function listFile`
 *
 * Returns the pretty-printed Modelica source for `cl`. Used by Option B
 * persistence: get the source, write it ourselves, then SetSourceFile.
 */

import { z } from "zod";

import type { CallContext } from "../../_shared/callContext.js";
import { TypeNameInput } from "../../_shared/inputs.js";
import { parseOutput } from "../../_shared/parseOutput.js";
import { expectString, parse } from "../../parse.js";

export const ListFileInputSchema = TypeNameInput;
export type ListFileInput = z.input<typeof ListFileInputSchema>;

export const ListFileOutputSchema = z.object({
  contents: z
    .string()
    .describe("Pretty-printed Modelica source for the class as one string."),
});
export type ListFileOutput = z.infer<typeof ListFileOutputSchema>;

export const ListFileDescription =
  "List the contents of the file backing a class — returns the pretty-printed Modelica source.";

export async function listFile(
  ctx: CallContext,
  input: ListFileInput,
): Promise<ListFileOutput> {
  const raw = await ctx.call(`listFile(${input.typeName})`);
  return parseOutput(
    ListFileOutputSchema,
    { contents: expectString(parse(raw)) },
    "listFile",
  );
}
