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
import { mlBool, quote, quoteList } from "../../_shared/format.js";
import { parseOutput } from "../../_shared/parseOutput.js";
import { expectBool, parse } from "../../parse.js";

export const LoadFilesInputSchema = z.object({
  fileNames: z.array(z.string()),
  encoding: z.string().optional().default("UTF-8"),
  numThreads: z.number().int().optional().default(0),
  uses: z.boolean().optional().default(true),
  notify: z.boolean().optional().default(true),
  requireExactVersion: z.boolean().optional().default(false),
  allowWithin: z.boolean().optional().default(true),
});
export type LoadFilesInput = z.input<typeof LoadFilesInputSchema>;

export const LoadFilesOutputSchema = z.object({
  success: z.boolean(),
});
export type LoadFilesOutput = z.infer<typeof LoadFilesOutputSchema>;

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
