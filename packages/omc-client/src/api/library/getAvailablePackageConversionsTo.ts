/**
 * OMC: `function getAvailablePackageConversionsTo`
 *
 * Returns the versions that provide a conversion TO the requested
 * `version` of the library — i.e. the set of source versions for which
 * OMC has a conversion script registered targeting the queried `version`.
 *
 * ```modelica
 * function getAvailablePackageConversionsTo
 *   input TypeName pkg;
 *   input String version;
 *   output String[:] convertsTo;
 * end getAvailablePackageConversionsTo;
 * ```
 *
 * Note: OMC's docs name the output `convertsTo` for both `…From` and `…To`
 * variants; the wrapper preserves the verbatim field name.
 */

import { z } from "zod";

import type { CallContext } from "../../_shared/callContext.js";
import { quote } from "../../_shared/format.js";
import { parseOutput } from "../../_shared/parseOutput.js";
import { expectStringList, parse } from "../../parse.js";

export const GetAvailablePackageConversionsToInputSchema = z.object({
  typeName: z
    .string()
    .describe(
      "Package name to query (OMC `pkg`, mapped to `typeName` per the package convention).",
    ),
  version: z
    .string()
    .describe(
      "Target version to look up; the result lists every version that has a registered conversion TO this one.",
    ),
});
export type GetAvailablePackageConversionsToInput = z.input<
  typeof GetAvailablePackageConversionsToInputSchema
>;

export const GetAvailablePackageConversionsToOutputSchema = z.object({
  convertsTo: z
    .array(z.string())
    .describe(
      "Versions for which OMC has a conversion registered targeting the queried `version`. Field name `convertsTo` is OMC verbatim.",
    ),
});
export type GetAvailablePackageConversionsToOutput = z.infer<
  typeof GetAvailablePackageConversionsToOutputSchema
>;

export const GetAvailablePackageConversionsToDescription =
  "List the versions that provide a conversion TO the requested version of the library.";

export async function getAvailablePackageConversionsTo(
  ctx: CallContext,
  input: GetAvailablePackageConversionsToInput,
): Promise<GetAvailablePackageConversionsToOutput> {
  const raw = await ctx.call(
    `getAvailablePackageConversionsTo(${input.typeName}, ${quote(input.version)})`,
  );
  return parseOutput(
    GetAvailablePackageConversionsToOutputSchema,
    { convertsTo: expectStringList(parse(raw)) },
    "getAvailablePackageConversionsTo",
  );
}
