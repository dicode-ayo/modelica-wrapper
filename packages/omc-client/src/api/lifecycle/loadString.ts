/**
 * OMC: `function loadString`
 *
 * Parses Modelica definitions from a string and merges (or replaces) them with
 * the already-loaded AST. Encoding is deprecated by OMC — strings are UTF-8.
 *
 * `filename` binds the loaded class(es) to that file in OMC's symbol table (and
 * drives diagnostics). Loading a class under a filename other than the one it
 * currently lives in *evicts* it from that file: an inline package member
 * loaded under a per-class pseudo-filename disappears from its `package.mo`,
 * so a later save of that package drops its siblings. When updating a class
 * that already exists on disk, pass its real source path (`getSourceFile`).
 *
 * ```modelica
 * function loadString
 *   input String data;
 *   input String filename = "<interactive>";
 *   input String encoding = "UTF-8";
 *   input Boolean merge = false;
 *   input Boolean uses = true;
 *   input Boolean notify = true;
 *   input Boolean requireExactVersion = false;
 *   output Boolean success;
 * end loadString;
 * ```
 */

import { z } from "zod";

import type { CallContext } from "../../_shared/callContext.js";
import { requireExactVersion } from "../../_shared/fields.js";
import { mlBool, quote } from "../../_shared/format.js";
import { SuccessOutput } from "../../_shared/outputs.js";
import { parseOutput } from "../../_shared/parseOutput.js";
import { expectBool, parse } from "../../parse.js";

export const LoadStringInputSchema = z.object({
  data: z.string().describe("Modelica source code to parse and load."),
  filename: z
    .string()
    .optional()
    .default("<interactive>")
    .describe(
      "File the loaded class(es) are bound to in OMC's symbol table, and the name used in diagnostics. Loading under a different filename evicts the class from the file it was stored in — pass the real source path when updating an existing class.",
    ),
  encoding: z
    .string()
    .optional()
    .default("UTF-8")
    .describe("Encoding label (deprecated by OMC; strings are UTF-8)."),
  merge: z
    .boolean()
    .optional()
    .default(false)
    .describe(
      "When true, merge the parsed AST into the existing one; otherwise replace.",
    ),
  uses: z
    .boolean()
    .optional()
    .default(true)
    .describe("Honor `uses` annotations and load referenced libraries."),
  notify: z
    .boolean()
    .optional()
    .default(true)
    .describe("Emit OMC notification messages while loading."),
  requireExactVersion,
});
export type LoadStringInput = z.input<typeof LoadStringInputSchema>;

export const LoadStringOutputSchema = SuccessOutput;
export type LoadStringOutput = z.infer<typeof LoadStringOutputSchema>;

export const LoadStringDescription =
  "Parse Modelica definitions from a string and merge (or replace) them with the already-loaded AST.";

export async function loadString(
  ctx: CallContext,
  input: LoadStringInput,
): Promise<LoadStringOutput> {
  const raw = await ctx.call(
    `loadString(${quote(input.data)}, ${quote(input.filename ?? "<interactive>")}, ${quote(input.encoding ?? "UTF-8")}, merge=${mlBool(input.merge ?? false)}, uses=${mlBool(input.uses ?? true)}, notify=${mlBool(input.notify ?? true)}, requireExactVersion=${mlBool(input.requireExactVersion ?? false)})`,
  );
  return parseOutput(
    LoadStringOutputSchema,
    { success: expectBool(parse(raw)) },
    "loadString",
  );
}
