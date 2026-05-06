/**
 * OMC: `function buildModelFMU`
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
  typeName: z.string(),
  version: z.enum(["1.0", "2.0", "3.0"]).optional().default("2.0"),
  fmuType: z.enum(["me", "cs", "me_cs"]).optional().default("me"),
  fileNamePrefix: z.string().optional().default("<default>"),
  platforms: z.array(z.string()).optional().default(["static"]),
  includeResources: z.boolean().optional().default(false),
});
export type BuildModelFMUInput = z.input<typeof BuildModelFMUInputSchema>;

export const BuildModelFMUOutputSchema = z.object({
  generatedFileName: z.string(),
});
export type BuildModelFMUOutput = z.infer<typeof BuildModelFMUOutputSchema>;

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
