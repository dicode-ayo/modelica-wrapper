/**
 * OMC: `function getLoadedLibraries`
 *
 * ```modelica
 * function getLoadedLibraries
 *   output String[:, 2] libraries;
 * end getLoadedLibraries;
 * ```
 *
 * Returns one `[name, version]` pair per loaded library.
 */

import { z } from "zod";

import type { CallContext } from "../../_shared/callContext.js";
import { parseOutput } from "../../_shared/parseOutput.js";
import { expectList, expectStringList, parse } from "../../parse.js";

export const GetLoadedLibrariesInputSchema = z.object({});
export type GetLoadedLibrariesInput = z.input<
  typeof GetLoadedLibrariesInputSchema
>;

export const GetLoadedLibrariesOutputSchema = z.object({
  libraries: z
    .array(z.tuple([z.string(), z.string()]))
    .describe("One `[name, version]` pair per loaded library."),
});
export type GetLoadedLibrariesOutput = z.infer<
  typeof GetLoadedLibrariesOutputSchema
>;

export const GetLoadedLibrariesDescription =
  "List currently loaded libraries as `(name, version)` pairs.";

export async function getLoadedLibraries(
  ctx: CallContext,
  _input: GetLoadedLibrariesInput = {},
): Promise<GetLoadedLibrariesOutput> {
  const raw = await ctx.call("getLoadedLibraries()");
  const rows = expectList(parse(raw));
  const libraries: [string, string][] = rows.map((row) => {
    const pair = expectStringList(row);
    if (pair.length < 2) {
      throw new Error(
        `getLoadedLibraries: malformed pair: ${JSON.stringify(pair)}`,
      );
    }
    return [pair[0] ?? "", pair[1] ?? ""];
  });
  return parseOutput(
    GetLoadedLibrariesOutputSchema,
    { libraries },
    "getLoadedLibraries",
  );
}
