/**
 * OMC: `function getSolverMethods`
 *
 * Returns the list of available DAE/ODE solver methods. Note: in OMC 1.26's
 * interactive context this often returns an empty list — the function is
 * deprecated in favor of `setCommandLineOptions("--solverMethod=...")`.
 */

import { z } from "zod";

import type { CallContext } from "../../_shared/callContext.js";
import { parseOutput } from "../../_shared/parseOutput.js";
import { expectStringList, parse } from "../../parse.js";

export const GetSolverMethodsInputSchema = z.object({});
export type GetSolverMethodsInput = z.input<
  typeof GetSolverMethodsInputSchema
>;

export const GetSolverMethodsOutputSchema = z.object({
  solverMethods: z.array(z.string()).describe("Names of available DAE/ODE solver methods (may be empty on OMC 1.26.x)."),
});
export type GetSolverMethodsOutput = z.infer<
  typeof GetSolverMethodsOutputSchema
>;

export const GetSolverMethodsDescription =
  "List the available DAE/ODE solver methods. (OMC docs page is 404; see file docstring.)";

export async function getSolverMethods(
  ctx: CallContext,
  _input: GetSolverMethodsInput = {},
): Promise<GetSolverMethodsOutput> {
  const raw = await ctx.call("getSolverMethods()");
  return parseOutput(
    GetSolverMethodsOutputSchema,
    { solverMethods: expectStringList(parse(raw)) },
    "getSolverMethods",
  );
}
