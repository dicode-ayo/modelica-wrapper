/**
 * OMC: `function loadString`
 *
 * Parses Modelica definitions from a string and merges (or replaces) them with
 * the already-loaded AST. `filename` is used only for diagnostics. Encoding is
 * deprecated by OMC — strings are UTF-8.
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
    .describe("Pseudo-filename used in OMC diagnostics for the loaded code."),
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
