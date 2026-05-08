/**
 * OMC: `function loadFile`
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
import { mlBool, quote } from "../../_shared/format.js";
import { SuccessOutput } from "../../_shared/outputs.js";
import { parseOutput } from "../../_shared/parseOutput.js";
import { expectBool, parse } from "../../parse.js";

export const LoadFileInputSchema = z.object({
  fileName: z.string(),
  encoding: z.string().optional().default("UTF-8"),
  uses: z.boolean().optional().default(true),
  notify: z.boolean().optional().default(true),
  requireExactVersion: z.boolean().optional().default(false),
  allowWithin: z.boolean().optional().default(true),
});
export type LoadFileInput = z.input<typeof LoadFileInputSchema>;

export const LoadFileOutputSchema = SuccessOutput;
export type LoadFileOutput = z.infer<typeof LoadFileOutputSchema>;

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
