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
  solverMethods: z.array(z.string()),
});
export type GetSolverMethodsOutput = z.infer<
  typeof GetSolverMethodsOutputSchema
>;

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
