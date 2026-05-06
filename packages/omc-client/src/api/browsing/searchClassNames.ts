/**
 * OMC: `function searchClassNames`
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
  searchText: z.string(),
  findInText: z.boolean().optional().default(false),
});
export type SearchClassNamesInput = z.input<typeof SearchClassNamesInputSchema>;

export const SearchClassNamesOutputSchema = z.object({
  classNames: z.array(z.string()),
});
export type SearchClassNamesOutput = z.infer<
  typeof SearchClassNamesOutputSchema
>;

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
