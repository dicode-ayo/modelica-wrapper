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
  filename: z.string().describe("Path to the `.fmu` file to import."),
  workdir: z.string().optional().default("").describe('Working directory for the import; "" uses the OMC default.'),
  loglevel: z.number().int().optional().default(0).describe("Log level used by the FMU import process."),
  fullPath: z.boolean().optional().default(false).describe("Return the absolute path to the generated Modelica file when true."),
  debugLogging: z.boolean().optional().default(false).describe("Enable debug logging during the import."),
  generateInputConnectors: z.boolean().optional().default(true).describe("Expose FMU inputs as Modelica input connectors."),
  generateOutputConnectors: z.boolean().optional().default(true).describe("Expose FMU outputs as Modelica output connectors."),
  modelName: z.string().optional().default("").describe("Override name for the generated wrapper class; empty uses the FMU's modelName."),
});
export type ImportFMUInput = z.input<typeof ImportFMUInputSchema>;

export const ImportFMUOutputSchema = z.object({
  generatedFileName: z.string().describe("Path to the generated Modelica wrapper file on disk."),
});
export type ImportFMUOutput = z.infer<typeof ImportFMUOutputSchema>;

export const ImportFMUDescription = "Import a Functional Mockup Unit and generate a Modelica wrapper class around it.";

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
