/**
 * OMC: `function installPackage`
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
  typeName: z.string(),
  version: z.string().optional().default(""),
  exactMatch: z.boolean().optional().default(false),
});
export type InstallPackageInput = z.input<typeof InstallPackageInputSchema>;

export const InstallPackageOutputSchema = z.object({
  result: z.boolean(),
});
export type InstallPackageOutput = z.infer<typeof InstallPackageOutputSchema>;

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
