/**
 * OMC: `function getPackages`
 *
 * ```modelica
 * function getPackages
 *   input TypeName class_ = $Code(AllLoadedClasses);
 *   output TypeName classNames[:];
 * end getPackages;
 * ```
 *
 * If `typeName` is omitted, OMC defaults to `AllLoadedClasses`.
 */

import { z } from "zod";

import type { CallContext } from "../../_shared/callContext.js";
import { parseOutput } from "../../_shared/parseOutput.js";
import { expectStringList, parse } from "../../parse.js";
import type { OmcCommand } from "../../commands.js";

export const GetPackagesInputSchema = z.object({
  typeName: z
    .string()
    .optional()
    .describe("Class to inspect; omit to default to OMC's AllLoadedClasses."),
});
export type GetPackagesInput = z.input<typeof GetPackagesInputSchema>;

export const GetPackagesOutputSchema = z.object({
  classNames: z
    .array(z.string())
    .describe("Names of package classes inside the requested class."),
});
export type GetPackagesOutput = z.infer<typeof GetPackagesOutputSchema>;

export const GetPackagesDescription =
  "List the package classes inside the given class (defaults to AllLoadedClasses, returning all top-level packages).";

export async function getPackages(
  ctx: CallContext,
  input: GetPackagesInput = {},
): Promise<GetPackagesOutput> {
  const cmd: OmcCommand =
    input.typeName === undefined || input.typeName === ""
      ? "getPackages()"
      : `getPackages(${input.typeName})`;
  const raw = await ctx.call(cmd);
  return parseOutput(
    GetPackagesOutputSchema,
    { classNames: expectStringList(parse(raw)) },
    "getPackages",
  );
}
