/**
 * OMC: `function loadFile`
 *
 * Loads a Modelica file with the given encoding and library-handling flags.
 * If the file is `package.mo` in a top-level class directory, OMC loads the
 * library as if `loadModel` had been called.
 *
 * ```modelica
 * function loadFile
 *   input String fileName;
 *   input String encoding = "UTF-8";
 *   input Boolean uses = true;
 *   input Boolean notify = true;
 *   input Boolean requireExactVersion = false;
 *   input Boolean allowWithin = true;
 *   output Boolean success;
 * end loadFile;
 * ```
 */

import { z } from "zod";

import type { CallContext } from "../../_shared/callContext.js";
import { requireExactVersion } from "../../_shared/fields.js";
import { mlBool, quote } from "../../_shared/format.js";
import { SuccessOutput } from "../../_shared/outputs.js";
import { parseOutput } from "../../_shared/parseOutput.js";
import { expectBool, parse } from "../../parse.js";

export const LoadFileInputSchema = z.object({
  fileName: z.string().describe("Path to the `.mo` Modelica file to load."),
  encoding: z.string().optional().default("UTF-8").describe("Text encoding of the file (default UTF-8)."),
  uses: z.boolean().optional().default(true).describe("Honor `uses` annotations and load referenced libraries."),
  notify: z.boolean().optional().default(true).describe("Emit OMC notification messages while loading."),
  requireExactVersion,
  allowWithin: z.boolean().optional().default(true).describe("Allow `within` clauses beyond the default in the loaded file."),
});
export type LoadFileInput = z.input<typeof LoadFileInputSchema>;

export const LoadFileOutputSchema = SuccessOutput;
export type LoadFileOutput = z.infer<typeof LoadFileOutputSchema>;

export const LoadFileDescription =
  "Load a Modelica file. If the file is `package.mo` in a top-level class directory, the library is loaded as if `loadModel` had been called.";

export async function loadFile(
  ctx: CallContext,
  input: LoadFileInput,
): Promise<LoadFileOutput> {
  const raw = await ctx.call(
    `loadFile(${quote(input.fileName)}, ${quote(input.encoding ?? "UTF-8")}, uses=${mlBool(input.uses ?? true)}, notify=${mlBool(input.notify ?? true)}, requireExactVersion=${mlBool(input.requireExactVersion ?? false)}, allowWithin=${mlBool(input.allowWithin ?? true)})`,
  );
  return parseOutput(
    LoadFileOutputSchema,
    { success: expectBool(parse(raw)) },
    "loadFile",
  );
}
