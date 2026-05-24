/**
 * Return the currently selected matching algorithm — sibling getter to
 * `setMatchingAlgorithm`. OMC docs:
 * https://build.openmodelica.org/Documentation/OpenModelica.Scripting.getMatchingAlgorithm.html
 *
 * Verbatim signature:
 * ```
 * function getMatchingAlgorithm
 *   output String selected;
 * end getMatchingAlgorithm;
 * ```
 *
 * Null/empty responses normalize to `""` to mirror the null-tolerance
 * pattern used across the solver getters.
 */

import { z } from "zod";

import type { CallContext } from "../../_shared/callContext.js";
import { parseOutput } from "../../_shared/parseOutput.js";
import { asString, parse } from "../../parse.js";

export const GetMatchingAlgorithmInputSchema = z.object({});
export type GetMatchingAlgorithmInput = z.input<
  typeof GetMatchingAlgorithmInputSchema
>;

export const GetMatchingAlgorithmOutputSchema = z.object({
  selected: z
    .string()
    .describe(
      "Name of the currently selected matching algorithm (empty string if OMC returns null).",
    ),
});
export type GetMatchingAlgorithmOutput = z.infer<
  typeof GetMatchingAlgorithmOutputSchema
>;

export const GetMatchingAlgorithmDescription =
  "Returns the currently used matching algorithm.";

export async function getMatchingAlgorithm(
  ctx: CallContext,
  _input: GetMatchingAlgorithmInput = {},
): Promise<GetMatchingAlgorithmOutput> {
  const raw = await ctx.call("getMatchingAlgorithm()");
  const value = parse(raw);
  return parseOutput(
    GetMatchingAlgorithmOutputSchema,
    { selected: asString(value) ?? "" },
    "getMatchingAlgorithm",
  );
}
