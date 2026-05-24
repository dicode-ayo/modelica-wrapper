/**
 * List the index-reduction methods available in this OMC build, alongside
 * a short human-readable comment for each — sibling enumerator to
 * `setIndexReductionMethod`. OMC docs:
 * https://build.openmodelica.org/Documentation/OpenModelica.Scripting.getAvailableIndexReductionMethods.html
 *
 * Verbatim signature:
 * ```
 * function getAvailableIndexReductionMethods
 *   output String[:] allChoices;
 *   output String[:] allComments;
 * end getAvailableIndexReductionMethods;
 * ```
 *
 * OMC returns a paren-tuple `({choice1, ...}, {comment1, ...})`. Null or
 * empty responses normalize to `[]` for both fields, mirroring the
 * null-tolerance pattern used across the solver getters.
 */

import { z } from "zod";

import type { CallContext } from "../../_shared/callContext.js";
import { parseOutput } from "../../_shared/parseOutput.js";
import { expectList, expectStringList, parse } from "../../parse.js";

export const GetAvailableIndexReductionMethodsInputSchema = z.object({});
export type GetAvailableIndexReductionMethodsInput = z.input<
  typeof GetAvailableIndexReductionMethodsInputSchema
>;

export const GetAvailableIndexReductionMethodsOutputSchema = z.object({
  allChoices: z
    .array(z.string())
    .describe(
      "Names of all index-reduction methods this OMC build offers.",
    ),
  allComments: z
    .array(z.string())
    .describe(
      "Human-readable comments, positionally aligned with `allChoices`.",
    ),
});
export type GetAvailableIndexReductionMethodsOutput = z.infer<
  typeof GetAvailableIndexReductionMethodsOutputSchema
>;

export const GetAvailableIndexReductionMethodsDescription =
  "Returns the currently available index-reduction methods.";

export async function getAvailableIndexReductionMethods(
  ctx: CallContext,
  _input: GetAvailableIndexReductionMethodsInput = {},
): Promise<GetAvailableIndexReductionMethodsOutput> {
  const raw = await ctx.call("getAvailableIndexReductionMethods()");
  const value = parse(raw);
  if (value.kind === "null") {
    return parseOutput(
      GetAvailableIndexReductionMethodsOutputSchema,
      { allChoices: [], allComments: [] },
      "getAvailableIndexReductionMethods",
    );
  }
  const tuple = expectList(value);
  if (tuple.length !== 2) {
    throw new Error(
      `getAvailableIndexReductionMethods: expected 2-tuple, got ${tuple.length} elements`,
    );
  }
  return parseOutput(
    GetAvailableIndexReductionMethodsOutputSchema,
    {
      allChoices: expectStringList(tuple[0]!),
      allComments: expectStringList(tuple[1]!),
    },
    "getAvailableIndexReductionMethods",
  );
}
