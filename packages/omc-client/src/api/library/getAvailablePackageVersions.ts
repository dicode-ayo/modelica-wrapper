/**
 * OMC: `function getAvailablePackageVersions`
 *
 * Returns package versions available in the OMC package index that satisfy the given version constraint.
 *
 * ```modelica
 * function getAvailablePackageVersions
 *   input TypeName pkg;
 *   input String version;
 *   output String[:] withoutConversion;
 * end getAvailablePackageVersions;
 * ```
 */

import { z } from "zod";

import type { CallContext } from "../../_shared/callContext.js";
import { quote } from "../../_shared/format.js";
import { parseOutput } from "../../_shared/parseOutput.js";
import { expectStringList, parse } from "../../parse.js";

export const GetAvailablePackageVersionsInputSchema = z.object({
  typeName: z.string().describe("Package name to query (OMC `pkg`, mapped to `typeName` per the package convention)."),
  version: z.string().describe("Version constraint string."),
});
export type GetAvailablePackageVersionsInput = z.input<
  typeof GetAvailablePackageVersionsInputSchema
>;

export const GetAvailablePackageVersionsOutputSchema = z.object({
  withoutConversion: z.array(z.string()).describe("Available package versions matching the constraint (excluding versions that would require a conversion)."),
});
export type GetAvailablePackageVersionsOutput = z.infer<
  typeof GetAvailablePackageVersionsOutputSchema
>;

export const GetAvailablePackageVersionsDescription =
  "List package versions available in the OMC package index that satisfy the given version constraint.";

export async function getAvailablePackageVersions(
  ctx: CallContext,
  input: GetAvailablePackageVersionsInput,
): Promise<GetAvailablePackageVersionsOutput> {
  const raw = await ctx.call(
    `getAvailablePackageVersions(${input.typeName}, ${quote(input.version)})`,
  );
  return parseOutput(
    GetAvailablePackageVersionsOutputSchema,
    { withoutConversion: expectStringList(parse(raw)) },
    "getAvailablePackageVersions",
  );
}
