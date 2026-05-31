/**
 * OMC: `function loadFiles`
 *
 * ```modelica
 * function loadFiles
 *   input String[:] fileNames;
 *   input String encoding = "UTF-8";
 *   input Integer numThreads = OpenModelica.Scripting.numProcessors();
 *   input Boolean uses = true;
 *   input Boolean notify = true;
 *   input Boolean requireExactVersion = false;
 *   input Boolean allowWithin = true;
 *   output Boolean success;
 * end loadFiles;
 * ```
 *
 * Batch variant of `loadFile`. The `numThreads` default in OMC is dynamic
 * (`numProcessors()`); we surface it as `0` and substitute the literal
 * `OpenModelica.Scripting.numProcessors()` expression when the caller leaves
 * it unset, so OMC evaluates the default at call time.
 */

import { z } from "zod";

import type { CallContext } from "../../_shared/callContext.js";
import { requireExactVersion } from "../../_shared/fields.js";
import { mlBool, quote, quoteList } from "../../_shared/format.js";
import { SuccessOutput } from "../../_shared/outputs.js";
import { parseOutput } from "../../_shared/parseOutput.js";
import { expectBool, parse } from "../../parse.js";

export const LoadFilesInputSchema = z.object({
  fileNames: z.array(z.string()).describe("Paths of Modelica files to load."),
  encoding: z
    .string()
    .optional()
    .default("UTF-8")
    .describe("Source encoding for the files."),
  numThreads: z
    .number()
    .int()
    .optional()
    .default(0)
    .describe(
      "Number of parallel threads; 0 substitutes the literal `OpenModelica.Scripting.numProcessors()` so OMC evaluates the default at call time.",
    ),
  uses: z
    .boolean()
    .optional()
    .default(true)
    .describe("Honor `uses` annotations to load dependencies when true."),
  notify: z
    .boolean()
    .optional()
    .default(true)
    .describe("Emit OMC notifications during loading when true."),
  requireExactVersion,
  allowWithin: z
    .boolean()
    .optional()
    .default(true)
    .describe("Permit `within` clauses in the loaded files when true."),
});
export type LoadFilesInput = z.input<typeof LoadFilesInputSchema>;

export const LoadFilesOutputSchema = SuccessOutput;
export type LoadFilesOutput = z.infer<typeof LoadFilesOutputSchema>;

export const LoadFilesDescription =
  "Load multiple Modelica files in a single call, optionally in parallel; batch variant of `loadFile`.";

export async function loadFiles(
  ctx: CallContext,
  input: LoadFilesInput,
): Promise<LoadFilesOutput> {
  const numThreads = input.numThreads ?? 0;
  const threadsArg =
    numThreads > 0 ? `${numThreads}` : `OpenModelica.Scripting.numProcessors()`;
  const raw = await ctx.call(
    `loadFiles(${quoteList(input.fileNames)}, ${quote(input.encoding ?? "UTF-8")}, ${threadsArg}, uses=${mlBool(input.uses ?? true)}, notify=${mlBool(input.notify ?? true)}, requireExactVersion=${mlBool(input.requireExactVersion ?? false)}, allowWithin=${mlBool(input.allowWithin ?? true)})`,
  );
  return parseOutput(
    LoadFilesOutputSchema,
    { success: expectBool(parse(raw)) },
    "loadFiles",
  );
}
