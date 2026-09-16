/**
 * OMC: `function listFile`
 *
 * Unparses the class from OMC's symbol table — the same memory `saveClass`
 * persists, not the file on disk. Used by Option B persistence: get the
 * source, write it ourselves, then SetSourceFile.
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
  "Returns OMC's in-memory pretty-printed Modelica source for a class, not the file on disk. " +
  "Every mutating tool changes that memory only, until saveClass writes it out — call saveClass " +
  "first if you need this to match what a restart would load.";

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
