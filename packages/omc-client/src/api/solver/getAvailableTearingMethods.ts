/**
 * List the tearing methods available in this OMC build, alongside a short
 * human-readable comment for each. No corresponding setter is wrapped in
 * this package yet — tearing methods are typically selected via
 * `setCommandLineOptions("--tearingMethod=...")`. OMC docs:
 * https://build.openmodelica.org/Documentation/OpenModelica.Scripting.getAvailableTearingMethods.html
 *
 * Verbatim signature:
 * ```
 * function getAvailableTearingMethods
 *   output String[:] allChoices;
 *   output String[:] allComments;
 * end getAvailableTearingMethods;
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

export const GetAvailableTearingMethodsInputSchema = z.object({});
export type GetAvailableTearingMethodsInput = z.input<
  typeof GetAvailableTearingMethodsInputSchema
>;

export const GetAvailableTearingMethodsOutputSchema = z.object({
  allChoices: z
    .array(z.string())
    .describe("Names of all tearing methods this OMC build offers."),
  allComments: z
    .array(z.string())
    .describe(
      "Human-readable comments, positionally aligned with `allChoices`.",
    ),
});
export type GetAvailableTearingMethodsOutput = z.infer<
  typeof GetAvailableTearingMethodsOutputSchema
>;

export const GetAvailableTearingMethodsDescription =
  "Returns the available tearing methods.";

export async function getAvailableTearingMethods(
  ctx: CallContext,
  _input: GetAvailableTearingMethodsInput = {},
): Promise<GetAvailableTearingMethodsOutput> {
  const raw = await ctx.call("getAvailableTearingMethods()");
  const value = parse(raw);
  if (value.kind === "null") {
    return parseOutput(
      GetAvailableTearingMethodsOutputSchema,
      { allChoices: [], allComments: [] },
      "getAvailableTearingMethods",
    );
  }
  const tuple = expectList(value);
  if (tuple.length !== 2) {
    throw new Error(
      `getAvailableTearingMethods: expected 2-tuple, got ${tuple.length} elements`,
    );
  }
  return parseOutput(
    GetAvailableTearingMethodsOutputSchema,
    {
      allChoices: expectStringList(tuple[0]!),
      allComments: expectStringList(tuple[1]!),
    },
    "getAvailableTearingMethods",
  );
}
