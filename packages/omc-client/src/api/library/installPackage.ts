/**
 * OMC: `function installPackage`
 *
 * Installs a package from the OMC package index. With `exactMatch=true`, requires the version to match exactly.
 *
 * ```modelica
 * function installPackage
 *   input TypeName pkg;
 *   input String version = "";
 *   input Boolean exactMatch = false;
 *   output Boolean result;
 * end installPackage;
 * ```
 */

import { z } from "zod";

import type { CallContext } from "../../_shared/callContext.js";
import { mlBool, quote } from "../../_shared/format.js";
import { parseOutput } from "../../_shared/parseOutput.js";
import { expectBool, parse } from "../../parse.js";

export const InstallPackageInputSchema = z.object({
  typeName: z
    .string()
    .describe(
      "Package name to install (OMC `pkg`, mapped to `typeName` per the package convention).",
    ),
  version: z
    .string()
    .optional()
    .default("")
    .describe("Version to install; empty selects OMC's default."),
  exactMatch: z
    .boolean()
    .optional()
    .default(false)
    .describe("Require an exact version match when true."),
});
export type InstallPackageInput = z.input<typeof InstallPackageInputSchema>;

export const InstallPackageOutputSchema = z.object({
  result: z
    .boolean()
    .describe(
      "True if the install succeeded; field name `result` is OMC verbatim.",
    ),
});
export type InstallPackageOutput = z.infer<typeof InstallPackageOutputSchema>;

export const InstallPackageDescription =
  "Install a package from the OMC package index. With `exactMatch=true`, requires the version to match exactly.";

export async function installPackage(
  ctx: CallContext,
  input: InstallPackageInput,
): Promise<InstallPackageOutput> {
  const version = input.version ?? "";
  const exactMatch = input.exactMatch ?? false;
  const raw = await ctx.call(
    `installPackage(${input.typeName}, ${quote(version)}, ${mlBool(exactMatch)})`,
  );
  return parseOutput(
    InstallPackageOutputSchema,
    { result: expectBool(parse(raw)) },
    "installPackage",
  );
}
