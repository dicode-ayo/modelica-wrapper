/**
 * OMC: `function getAvailablePackageConversionsFrom`
 *
 * Returns the versions that can be converted FROM the given version of a
 * package — i.e. the set of versions for which OMC has a conversion script
 * registered with the queried `version` as its source.
 *
 * ```modelica
 * function getAvailablePackageConversionsFrom
 *   input TypeName pkg;
 *   input String version;
 *   output String[:] convertsTo;
 * end getAvailablePackageConversionsFrom;
 * ```
 */

import { z } from "zod";

import type { CallContext } from "../../_shared/callContext.js";
import { quote } from "../../_shared/format.js";
import { parseOutput } from "../../_shared/parseOutput.js";
import { expectStringList, parse } from "../../parse.js";

export const GetAvailablePackageConversionsFromInputSchema = z.object({
  typeName: z
    .string()
    .describe(
      "Package name to query (OMC `pkg`, mapped to `typeName` per the package convention).",
    ),
  version: z
    .string()
    .describe(
      "Source version to look up; the result lists every version that has a registered conversion FROM this one.",
    ),
});
export type GetAvailablePackageConversionsFromInput = z.input<
  typeof GetAvailablePackageConversionsFromInputSchema
>;

export const GetAvailablePackageConversionsFromOutputSchema = z.object({
  convertsTo: z
    .array(z.string())
    .describe(
      "Versions for which OMC has a conversion registered with the queried `version` as the source.",
    ),
});
export type GetAvailablePackageConversionsFromOutput = z.infer<
  typeof GetAvailablePackageConversionsFromOutputSchema
>;

export const GetAvailablePackageConversionsFromDescription =
  "List the versions that can be converted FROM the given version of a package (i.e. versions reachable via OMC's registered conversion scripts).";

export async function getAvailablePackageConversionsFrom(
  ctx: CallContext,
  input: GetAvailablePackageConversionsFromInput,
): Promise<GetAvailablePackageConversionsFromOutput> {
  const raw = await ctx.call(
    `getAvailablePackageConversionsFrom(${input.typeName}, ${quote(input.version)})`,
  );
  return parseOutput(
    GetAvailablePackageConversionsFromOutputSchema,
    { convertsTo: expectStringList(parse(raw)) },
    "getAvailablePackageConversionsFrom",
  );
}
