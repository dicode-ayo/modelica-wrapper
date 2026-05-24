/**
 * Return the currently selected index-reduction method — sibling getter
 * to `setIndexReductionMethod`. OMC docs:
 * https://build.openmodelica.org/Documentation/OpenModelica.Scripting.getIndexReductionMethod.html
 *
 * Verbatim signature:
 * ```
 * function getIndexReductionMethod
 *   output String selected;
 * end getIndexReductionMethod;
 * ```
 *
 * Null/empty responses normalize to `""` to mirror the null-tolerance
 * pattern used across the solver getters.
 */

import { z } from "zod";

import type { CallContext } from "../../_shared/callContext.js";
import { parseOutput } from "../../_shared/parseOutput.js";
import { asString, parse } from "../../parse.js";

export const GetIndexReductionMethodInputSchema = z.object({});
export type GetIndexReductionMethodInput = z.input<
  typeof GetIndexReductionMethodInputSchema
>;

export const GetIndexReductionMethodOutputSchema = z.object({
  selected: z
    .string()
    .describe(
      "Name of the currently selected index-reduction method (empty string if OMC returns null).",
    ),
});
export type GetIndexReductionMethodOutput = z.infer<
  typeof GetIndexReductionMethodOutputSchema
>;

export const GetIndexReductionMethodDescription =
  "Returns the currently configured index-reduction method.";

export async function getIndexReductionMethod(
  ctx: CallContext,
  _input: GetIndexReductionMethodInput = {},
): Promise<GetIndexReductionMethodOutput> {
  const raw = await ctx.call("getIndexReductionMethod()");
  const value = parse(raw);
  return parseOutput(
    GetIndexReductionMethodOutputSchema,
    { selected: asString(value) ?? "" },
    "getIndexReductionMethod",
  );
}
