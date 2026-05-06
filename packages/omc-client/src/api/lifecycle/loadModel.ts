/**
 * OMC: `function loadModel`
 *
 * ```modelica
 * function loadModel
 *   input TypeName className;
 *   input String[:] priorityVersion = {"default"};
 *   input Boolean notify = false;
 *   input String languageStandard = "";
 *   input Boolean requireExactVersion = false;
 *   output Boolean success;
 * end loadModel;
 * ```
 */

import { z } from "zod";

import type { CallContext } from "../../_shared/callContext.js";
import { mlBool, quote, quoteList } from "../../_shared/format.js";
import { parseOutput } from "../../_shared/parseOutput.js";
import { expectBool, parse } from "../../parse.js";

export const LoadModelInputSchema = z.object({
  typeName: z.string(),
  priorityVersion: z.array(z.string()).optional().default(["default"]),
  notify: z.boolean().optional().default(false),
  languageStandard: z.string().optional().default(""),
  requireExactVersion: z.boolean().optional().default(false),
});
export type LoadModelInput = z.input<typeof LoadModelInputSchema>;

export const LoadModelOutputSchema = z.object({
  success: z.boolean(),
});
export type LoadModelOutput = z.infer<typeof LoadModelOutputSchema>;

export async function loadModel(
  ctx: CallContext,
  input: LoadModelInput,
): Promise<LoadModelOutput> {
  const versions = input.priorityVersion ?? ["default"];
  const raw = await ctx.call(
    `loadModel(${input.typeName}, ${quoteList(versions)}, ${mlBool(input.notify ?? false)}, ${quote(input.languageStandard ?? "")}, ${mlBool(input.requireExactVersion ?? false)})`,
  );
  return parseOutput(
    LoadModelOutputSchema,
    { success: expectBool(parse(raw)) },
    "loadModel",
  );
}
