/**
 * OMC: `function getAvailableLibraries`
 *
 * ```modelica
 * function getAvailableLibraries
 *   output String[:] libraries;
 * end getAvailableLibraries;
 * ```
 */

import { z } from "zod";

import type { CallContext } from "../../_shared/callContext.js";
import { parseOutput } from "../../_shared/parseOutput.js";
import { expectStringList, parse } from "../../parse.js";

export const GetAvailableLibrariesInputSchema = z.object({});
export type GetAvailableLibrariesInput = z.input<
  typeof GetAvailableLibrariesInputSchema
>;

export const GetAvailableLibrariesOutputSchema = z.object({
  libraries: z.array(z.string()),
});
export type GetAvailableLibrariesOutput = z.infer<
  typeof GetAvailableLibrariesOutputSchema
>;

export async function getAvailableLibraries(
  ctx: CallContext,
  _input: GetAvailableLibrariesInput = {},
): Promise<GetAvailableLibrariesOutput> {
  const raw = await ctx.call("getAvailableLibraries()");
  return parseOutput(
    GetAvailableLibrariesOutputSchema,
    { libraries: expectStringList(parse(raw)) },
    "getAvailableLibraries",
  );
}
