/**
 * OMC: `function updatePackageIndex`
 *
 * ```modelica
 * function updatePackageIndex
 *   output Boolean result;
 * end updatePackageIndex;
 * ```
 *
 * Refreshes OMC's local copy of the package index from the registry. Network
 * side-effect; not exercised by integration tests.
 */

import { z } from "zod";

import type { CallContext } from "../../_shared/callContext.js";
import { parseOutput } from "../../_shared/parseOutput.js";
import { expectBool, parse } from "../../parse.js";

export const UpdatePackageIndexInputSchema = z.object({});
export type UpdatePackageIndexInput = z.input<
  typeof UpdatePackageIndexInputSchema
>;

export const UpdatePackageIndexOutputSchema = z.object({
  result: z.boolean().describe("True if the index refresh succeeded; field name `result` is OMC verbatim."),
});
export type UpdatePackageIndexOutput = z.infer<
  typeof UpdatePackageIndexOutputSchema
>;

export const UpdatePackageIndexDescription =
  "Refresh OMC's local copy of the package index from the registry. Network side-effect.";

export async function updatePackageIndex(
  ctx: CallContext,
  _input: UpdatePackageIndexInput = {},
): Promise<UpdatePackageIndexOutput> {
  const raw = await ctx.call("updatePackageIndex()");
  return parseOutput(
    UpdatePackageIndexOutputSchema,
    { result: expectBool(parse(raw)) },
    "updatePackageIndex",
  );
}
