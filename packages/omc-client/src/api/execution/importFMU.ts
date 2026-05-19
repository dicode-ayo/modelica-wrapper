/**
 * OMC: `function importFMU`
 *
 * ```modelica
 * function importFMU
 *   input String filename;
 *   input String workdir = "<default>";
 *   input Integer loglevel = 3;
 *   input Boolean fullPath = false;
 *   input Boolean debugLogging = false;
 *   input Boolean generateInputConnectors = true;
 *   input Boolean generateOutputConnectors = true;
 *   input TypeName modelName = $Code(Default);
 *   output String generatedFileName;
 * end importFMU;
 * ```
 *
 * Import an FMU and generate a Modelica wrapper class.
 *
 * NOTE on `modelName` shape: per the docs the last argument is a
 * `TypeName` (bare ident), NOT a String. Passing it as a quoted string
 * triggers the misleading "Class importFMU not found in scope"
 * diagnostic (see `docs/audit.md` §2.10). The wrapper emits it bare,
 * defaulting to the OMC-accepted sentinel `Default` (the docs name the
 * default `$Code(Default)`, but only the bare-ident form actually
 * round-trips through OMC 1.26's interactive RPC).
 */

import { z } from "zod";

import type { CallContext } from "../../_shared/callContext.js";
import { mlBool, quote } from "../../_shared/format.js";
import { parseOutput } from "../../_shared/parseOutput.js";
import { expectString, parse } from "../../parse.js";

export const ImportFMUInputSchema = z.object({
  filename: z.string().describe("Path to the `.fmu` file to import."),
  workdir: z
    .string()
    .optional()
    .default("<default>")
    .describe(
      'Output directory for the generated files; "<default>" lets OMC use the current working directory.',
    ),
  loglevel: z
    .number()
    .int()
    .optional()
    .default(3)
    .describe(
      "OMC's FMU import log level (0=nothing … 3=warning … 6=debug).",
    ),
  fullPath: z
    .boolean()
    .optional()
    .default(false)
    .describe("Return the absolute path to the generated Modelica file when true."),
  debugLogging: z
    .boolean()
    .optional()
    .default(false)
    .describe("Enable debug logging during the import."),
  generateInputConnectors: z
    .boolean()
    .optional()
    .default(true)
    .describe("Expose FMU inputs as Modelica input connectors."),
  generateOutputConnectors: z
    .boolean()
    .optional()
    .default(true)
    .describe("Expose FMU outputs as Modelica output connectors."),
  modelName: z
    .string()
    .optional()
    .default("")
    .describe(
      "Override name for the generated wrapper class (Modelica TypeName, emitted bare); empty defers to the OMC default (derives the name from the FMU).",
    ),
});
export type ImportFMUInput = z.input<typeof ImportFMUInputSchema>;

export const ImportFMUOutputSchema = z.object({
  generatedFileName: z.string().describe("Path to the generated Modelica wrapper file on disk."),
});
export type ImportFMUOutput = z.infer<typeof ImportFMUOutputSchema>;

export const ImportFMUDescription =
  "Import a Functional Mockup Unit (FMU) and generate a Modelica wrapper class around it.";

export async function importFMU(
  ctx: CallContext,
  input: ImportFMUInput,
): Promise<ImportFMUOutput> {
  const modelNameArg =
    input.modelName === undefined || input.modelName === ""
      ? "Default"
      : input.modelName;
  const raw = await ctx.call(
    `importFMU(${quote(input.filename)}, ${quote(input.workdir ?? "<default>")}, ${input.loglevel ?? 3}, ${mlBool(input.fullPath ?? false)}, ${mlBool(input.debugLogging ?? false)}, ${mlBool(input.generateInputConnectors ?? true)}, ${mlBool(input.generateOutputConnectors ?? true)}, ${modelNameArg})`,
  );
  return parseOutput(
    ImportFMUOutputSchema,
    { generatedFileName: expectString(parse(raw)) },
    "importFMU",
  );
}
