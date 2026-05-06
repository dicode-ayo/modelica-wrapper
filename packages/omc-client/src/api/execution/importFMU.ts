/**
 * OMC: `function importFMU`
 *
 * Import an FMU and generate a Modelica wrapper class.
 */

import { z } from "zod";

import type { CallContext } from "../../_shared/callContext.js";
import { mlBool, quote } from "../../_shared/format.js";
import { parseOutput } from "../../_shared/parseOutput.js";
import { expectString, parse } from "../../parse.js";

export const ImportFMUInputSchema = z.object({
  filename: z.string(),
  workdir: z.string().optional().default(""),
  loglevel: z.number().int().optional().default(0),
  fullPath: z.boolean().optional().default(false),
  debugLogging: z.boolean().optional().default(false),
  generateInputConnectors: z.boolean().optional().default(true),
  generateOutputConnectors: z.boolean().optional().default(true),
  modelName: z.string().optional().default(""),
});
export type ImportFMUInput = z.input<typeof ImportFMUInputSchema>;

export const ImportFMUOutputSchema = z.object({
  generatedFileName: z.string(),
});
export type ImportFMUOutput = z.infer<typeof ImportFMUOutputSchema>;

export async function importFMU(
  ctx: CallContext,
  input: ImportFMUInput,
): Promise<ImportFMUOutput> {
  const raw = await ctx.call(
    `importFMU(${quote(input.filename)}, ${quote(input.workdir ?? "")}, ${input.loglevel ?? 0}, ${mlBool(input.fullPath ?? false)}, ${mlBool(input.debugLogging ?? false)}, ${mlBool(input.generateInputConnectors ?? true)}, ${mlBool(input.generateOutputConnectors ?? true)}, ${quote(input.modelName ?? "")})`,
  );
  return parseOutput(
    ImportFMUOutputSchema,
    { generatedFileName: expectString(parse(raw)) },
    "importFMU",
  );
}
