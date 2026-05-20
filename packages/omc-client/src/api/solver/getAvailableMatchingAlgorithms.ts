/**
 * List the matching algorithms available in this OMC build, alongside a
 * short human-readable comment for each — sibling enumerator to
 * `setMatchingAlgorithm`. OMC docs:
 * https://build.openmodelica.org/Documentation/OpenModelica.Scripting.getAvailableMatchingAlgorithms.html
 *
 * Verbatim signature:
 * ```
 * function getAvailableMatchingAlgorithms
 *   output String[:] allChoices;
 *   output String[:] allComments;
 * end getAvailableMatchingAlgorithms;
 * ```
 *
 * OMC returns a paren-tuple `({choice1, ...}, {comment1, ...})`. Null or
 * empty responses normalize to `[]` for both fields, mirroring the
 * null-tolerance pattern used by `getSolverMethods` & friends.
 */

import { z } from "zod";

import type { CallContext } from "../../_shared/callContext.js";
import { parseOutput } from "../../_shared/parseOutput.js";
import { expectList, expectStringList, parse } from "../../parse.js";

export const GetAvailableMatchingAlgorithmsInputSchema = z.object({});
export type GetAvailableMatchingAlgorithmsInput = z.input<
  typeof GetAvailableMatchingAlgorithmsInputSchema
>;

export const GetAvailableMatchingAlgorithmsOutputSchema = z.object({
  allChoices: z
    .array(z.string())
    .describe("Names of all matching algorithms this OMC build offers."),
  allComments: z
    .array(z.string())
    .describe(
      "Human-readable comments, positionally aligned with `allChoices`.",
    ),
});
export type GetAvailableMatchingAlgorithmsOutput = z.infer<
  typeof GetAvailableMatchingAlgorithmsOutputSchema
>;

export const GetAvailableMatchingAlgorithmsDescription =
  "Returns the available matching algorithms.";

export async function getAvailableMatchingAlgorithms(
  ctx: CallContext,
  _input: GetAvailableMatchingAlgorithmsInput = {},
): Promise<GetAvailableMatchingAlgorithmsOutput> {
  const raw = await ctx.call("getAvailableMatchingAlgorithms()");
  const value = parse(raw);
  if (value.kind === "null") {
    return parseOutput(
      GetAvailableMatchingAlgorithmsOutputSchema,
      { allChoices: [], allComments: [] },
      "getAvailableMatchingAlgorithms",
    );
  }
  const tuple = expectList(value);
  if (tuple.length !== 2) {
    throw new Error(
      `getAvailableMatchingAlgorithms: expected 2-tuple, got ${tuple.length} elements`,
    );
  }
  return parseOutput(
    GetAvailableMatchingAlgorithmsOutputSchema,
    {
      allChoices: expectStringList(tuple[0]!),
      allComments: expectStringList(tuple[1]!),
    },
    "getAvailableMatchingAlgorithms",
  );
}
