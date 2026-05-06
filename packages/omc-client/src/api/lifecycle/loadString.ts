/**
 * OMC: `function loadString`
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
import { mlBool, quote } from "../../_shared/format.js";
import { parseOutput } from "../../_shared/parseOutput.js";
import { expectBool, parse } from "../../parse.js";

export const LoadStringInputSchema = z.object({
  data: z.string(),
  filename: z.string().optional().default("<interactive>"),
  encoding: z.string().optional().default("UTF-8"),
  merge: z.boolean().optional().default(false),
  uses: z.boolean().optional().default(true),
  notify: z.boolean().optional().default(true),
  requireExactVersion: z.boolean().optional().default(false),
});
export type LoadStringInput = z.input<typeof LoadStringInputSchema>;

export const LoadStringOutputSchema = z.object({
  success: z.boolean(),
});
export type LoadStringOutput = z.infer<typeof LoadStringOutputSchema>;

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
