/**
 * OMC: `function getAvailablePackageVersions`
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
  typeName: z.string(),
  version: z.string(),
});
export type GetAvailablePackageVersionsInput = z.input<
  typeof GetAvailablePackageVersionsInputSchema
>;

export const GetAvailablePackageVersionsOutputSchema = z.object({
  withoutConversion: z.array(z.string()),
});
export type GetAvailablePackageVersionsOutput = z.infer<
  typeof GetAvailablePackageVersionsOutputSchema
>;

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
