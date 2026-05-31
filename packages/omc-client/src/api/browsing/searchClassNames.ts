/**
 * OMC: `function searchClassNames`
 *
 * Searches the loaded classes for `searchText`. Returns class names whose name
 * contains the search text; with `findInText=true`, also matches classes whose
 * source code contains the term.
 *
 * ```modelica
 * function searchClassNames
 *   input String searchText;
 *   input Boolean findInText = false;
 *   output TypeName classNames[:];
 * end searchClassNames;
 * ```
 */

import { z } from "zod";

import type { CallContext } from "../../_shared/callContext.js";
import { mlBool, quote } from "../../_shared/format.js";
import { parseOutput } from "../../_shared/parseOutput.js";
import { expectStringList, parse } from "../../parse.js";

export const SearchClassNamesInputSchema = z.object({
  searchText: z
    .string()
    .describe("Substring to look for in loaded class names."),
  findInText: z
    .boolean()
    .optional()
    .default(false)
    .describe(
      "Also match classes whose source code text (not just the name) contains `searchText`.",
    ),
});
export type SearchClassNamesInput = z.input<typeof SearchClassNamesInputSchema>;

export const SearchClassNamesOutputSchema = z.object({
  classNames: z
    .array(z.string())
    .describe("Fully qualified class names matching the search."),
});
export type SearchClassNamesOutput = z.infer<
  typeof SearchClassNamesOutputSchema
>;

export const SearchClassNamesDescription =
  "Search the loaded classes for a substring. Matches names by default; with findInText=true also matches inside class source text.";

export async function searchClassNames(
  ctx: CallContext,
  input: SearchClassNamesInput,
): Promise<SearchClassNamesOutput> {
  const findInText = input.findInText ?? false;
  const raw = await ctx.call(
    `searchClassNames(${quote(input.searchText)}, findInText=${mlBool(findInText)})`,
  );
  return parseOutput(
    SearchClassNamesOutputSchema,
    { classNames: expectStringList(parse(raw)) },
    "searchClassNames",
  );
}
