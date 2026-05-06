/**
 * OMC: `function getAvailableLibraryVersions`
 *
 * ```modelica
 * function getAvailableLibraryVersions
 *   input TypeName libraryName;
 *   output String[:] librariesAndVersions;
 * end getAvailableLibraryVersions;
 * ```
 */

import { z } from "zod";

import type { CallContext } from "../../_shared/callContext.js";
import { TypeNameInput } from "../../_shared/inputs.js";
import { parseOutput } from "../../_shared/parseOutput.js";
import { expectStringList, parse } from "../../parse.js";

export const GetAvailableLibraryVersionsInputSchema = TypeNameInput;
export type GetAvailableLibraryVersionsInput = z.input<
  typeof GetAvailableLibraryVersionsInputSchema
>;

export const GetAvailableLibraryVersionsOutputSchema = z.object({
  librariesAndVersions: z.array(z.string()),
});
export type GetAvailableLibraryVersionsOutput = z.infer<
  typeof GetAvailableLibraryVersionsOutputSchema
>;

export async function getAvailableLibraryVersions(
  ctx: CallContext,
  input: GetAvailableLibraryVersionsInput,
): Promise<GetAvailableLibraryVersionsOutput> {
  const raw = await ctx.call(
    `getAvailableLibraryVersions(${input.typeName})`,
  );
  return parseOutput(
    GetAvailableLibraryVersionsOutputSchema,
    { librariesAndVersions: expectStringList(parse(raw)) },
    "getAvailableLibraryVersions",
  );
}
