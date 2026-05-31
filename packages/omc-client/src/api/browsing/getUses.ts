/**
 * OMC: `function getUses`
 *
 * Returns the libraries used by a package via its `uses` annotation, as a list
 * of `(libraryName, version)` pairs.
 *
 * ```modelica
 * function getUses
 *   input TypeName pack;
 *   output String[:, :] uses;
 * end getUses;
 * ```
 *
 * The 2D string matrix is in practice an array of `(libraryName, version)` pairs.
 */

import { z } from "zod";

import type { CallContext } from "../../_shared/callContext.js";
import { TypeNameInput } from "../../_shared/inputs.js";
import { parseOutput } from "../../_shared/parseOutput.js";
import { expectList, expectStringList, parse } from "../../parse.js";

export const GetUsesInputSchema = TypeNameInput;
export type GetUsesInput = z.input<typeof GetUsesInputSchema>;

export const GetUsesOutputSchema = z.object({
  uses: z
    .array(z.tuple([z.string(), z.string()]))
    .describe(
      "List of (libraryName, version) pairs declared in the package's `uses` annotation.",
    ),
});
export type GetUsesOutput = z.infer<typeof GetUsesOutputSchema>;

export const GetUsesDescription =
  "Return the libraries used by a package, as `(libraryName, version)` pairs taken from the `uses` annotation.";

export async function getUses(
  ctx: CallContext,
  input: GetUsesInput,
): Promise<GetUsesOutput> {
  const raw = await ctx.call(`getUses(${input.typeName})`);
  const rows = expectList(parse(raw));
  const uses: [string, string][] = rows.map((row) => {
    const pair = expectStringList(row);
    if (pair.length < 2) {
      throw new Error(`getUses: malformed pair: ${JSON.stringify(pair)}`);
    }
    return [pair[0] ?? "", pair[1] ?? ""];
  });
  return parseOutput(GetUsesOutputSchema, { uses }, "getUses");
}
