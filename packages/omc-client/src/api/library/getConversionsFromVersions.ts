/**
 * OMC: `function getConversionsFromVersions`
 *
 * Returns the versions a library can be converted from, partitioned by
 * whether OMC has conversion steps registered for them. Versions in
 * `withoutConversion` are source-compatible with the loaded library;
 * versions in `withConversion` require OMC to apply the registered
 * conversion script(s).
 *
 * ```modelica
 * function getConversionsFromVersions
 *   input TypeName pack;
 *   output String[:] withoutConversion;
 *   output String[:] withConversion;
 * end getConversionsFromVersions;
 * ```
 *
 * OMC's interactive RPC returns the two outputs as a paren-tuple
 * `(withoutConversion, withConversion)`, mirroring the pattern used by
 * `diffSimulationResults`.
 */

import { z } from "zod";

import type { CallContext } from "../../_shared/callContext.js";
import { TypeNameInput } from "../../_shared/inputs.js";
import { parseOutput } from "../../_shared/parseOutput.js";
import { expectList, expectStringList, parse } from "../../parse.js";

export const GetConversionsFromVersionsInputSchema = TypeNameInput;
export type GetConversionsFromVersionsInput = z.input<
  typeof GetConversionsFromVersionsInputSchema
>;

export const GetConversionsFromVersionsOutputSchema = z.object({
  withoutConversion: z
    .array(z.string())
    .describe(
      "Versions of the package that are source-compatible with the currently loaded library (no conversion steps required).",
    ),
  withConversion: z
    .array(z.string())
    .describe(
      "Versions of the package that require OMC's registered conversion steps to migrate from.",
    ),
});
export type GetConversionsFromVersionsOutput = z.infer<
  typeof GetConversionsFromVersionsOutputSchema
>;

export const GetConversionsFromVersionsDescription =
  "List the versions a library can be converted from, partitioned into those requiring conversion steps and those that don't.";

export async function getConversionsFromVersions(
  ctx: CallContext,
  input: GetConversionsFromVersionsInput,
): Promise<GetConversionsFromVersionsOutput> {
  const raw = await ctx.call(
    `getConversionsFromVersions(${input.typeName})`,
  );
  // OMC returns a paren-tuple `(withoutConversion, withConversion)`.
  const tuple = expectList(parse(raw));
  if (tuple.length !== 2) {
    throw new Error(
      `getConversionsFromVersions: expected 2-tuple, got ${tuple.length} elements`,
    );
  }
  return parseOutput(
    GetConversionsFromVersionsOutputSchema,
    {
      withoutConversion: expectStringList(tuple[0]!),
      withConversion: expectStringList(tuple[1]!),
    },
    "getConversionsFromVersions",
  );
}
