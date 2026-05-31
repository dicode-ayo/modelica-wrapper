/**
 * OMC: `function buildModelFMU`
 *
 * Translates a Modelica model into a Functional Mockup Unit (FMU). All
 * arguments other than `className` have defaults; returns the path to the
 * generated `.fmu` file.
 *
 * ```modelica
 * function buildModelFMU
 *   input TypeName className;
 *   input String version = "2.0";
 *   input String fmuType = "me";
 *   input String fileNamePrefix = "<default>";
 *   input String platforms[:] = {"static"};
 *   input Boolean includeResources = false;
 *   output String generatedFileName;
 * end buildModelFMU;
 * ```
 */

import { z } from "zod";

import type { CallContext } from "../../_shared/callContext.js";
import { mlBool, quote, quoteList } from "../../_shared/format.js";
import { parseOutput } from "../../_shared/parseOutput.js";
import { expectString, parse } from "../../parse.js";

export const BuildModelFMUInputSchema = z.object({
  typeName: z.string().describe("Class to export as an FMU."),
  version: z
    .enum(["1.0", "2.0", "3.0"])
    .optional()
    .default("2.0")
    .describe("FMI specification version to target."),
  fmuType: z
    .enum(["me", "cs", "me_cs"])
    .optional()
    .default("me")
    .describe(
      "FMU kind: model exchange (`me`), co-simulation (`cs`), or both (`me_cs`).",
    ),
  fileNamePrefix: z
    .string()
    .optional()
    .default("<default>")
    .describe('Prefix for generated FMU filename; "<default>" lets OMC pick.'),
  platforms: z
    .array(z.string())
    .optional()
    .default(["static"])
    .describe(
      'Target platforms for the FMU binaries (e.g. ["static"], ["x86_64-linux-gnu"]).',
    ),
  includeResources: z
    .boolean()
    .optional()
    .default(false)
    .describe(
      "Include resource files in the FMU. (OMC docs: deprecated and has no effect; passed through positionally.)",
    ),
});
export type BuildModelFMUInput = z.input<typeof BuildModelFMUInputSchema>;

export const BuildModelFMUOutputSchema = z.object({
  generatedFileName: z
    .string()
    .describe("Path to the generated `.fmu` file on disk."),
});
export type BuildModelFMUOutput = z.infer<typeof BuildModelFMUOutputSchema>;

export const BuildModelFMUDescription =
  "Translate a Modelica model into a Functional Mockup Unit (FMU) and return the generated file path.";

export async function buildModelFMU(
  ctx: CallContext,
  input: BuildModelFMUInput,
): Promise<BuildModelFMUOutput> {
  const platforms = input.platforms ?? ["static"];
  const raw = await ctx.call(
    `buildModelFMU(${input.typeName}, version=${quote(input.version ?? "2.0")}, fmuType=${quote(input.fmuType ?? "me")}, fileNamePrefix=${quote(input.fileNamePrefix ?? "<default>")}, platforms=${quoteList(platforms)}, includeResources=${mlBool(input.includeResources ?? false)})`,
  );
  return parseOutput(
    BuildModelFMUOutputSchema,
    { generatedFileName: expectString(parse(raw)) },
    "buildModelFMU",
  );
}
