/**
 * OMC: `function loadModel`
 *
 * Loads a Modelica library by searching the MODELICAPATH for candidate
 * packages matching `className`. Version selection follows priorityVersion;
 * when "default", OMC prefers no version > highest main release > highest
 * pre-release > lexical sort.
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
import { requireExactVersion } from "../../_shared/fields.js";
import { mlBool, quote, quoteList } from "../../_shared/format.js";
import { SuccessOutput } from "../../_shared/outputs.js";
import { parseOutput } from "../../_shared/parseOutput.js";
import { expectBool, parse } from "../../parse.js";

export const LoadModelInputSchema = z.object({
  typeName: z
    .string()
    .describe(
      'Library to load (e.g. "Modelica"); resolved against the MODELICAPATH.',
    ),
  priorityVersion: z
    .array(z.string())
    .optional()
    .default(["default"])
    .describe(
      'Version priority list. "default" means: no version > highest main release > highest pre-release > lexical sort.',
    ),
  notify: z
    .boolean()
    .optional()
    .default(false)
    .describe("Emit OMC notification messages while loading."),
  languageStandard: z
    .string()
    .optional()
    .default("")
    .describe(
      'Modelica language standard to enforce when loading (e.g. "3.2"); empty means use OMC default.',
    ),
  requireExactVersion,
});
export type LoadModelInput = z.input<typeof LoadModelInputSchema>;

export const LoadModelOutputSchema = SuccessOutput;
export type LoadModelOutput = z.infer<typeof LoadModelOutputSchema>;

export const LoadModelDescription =
  "Load a Modelica library by searching the MODELICAPATH for the named package, honoring the priorityVersion order.";

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
