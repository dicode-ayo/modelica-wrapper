/**
 * OMC: `function getNonLinearSolvers`
 *
 * Returns the list of available nonlinear solvers.
 */

import { z } from "zod";

import type { CallContext } from "../../_shared/callContext.js";
import { parseOutput } from "../../_shared/parseOutput.js";
import { expectStringList, parse } from "../../parse.js";

export const GetNonLinearSolversInputSchema = z.object({});
export type GetNonLinearSolversInput = z.input<
  typeof GetNonLinearSolversInputSchema
>;

export const GetNonLinearSolversOutputSchema = z.object({
  nonLinearSolvers: z.array(z.string()).describe("Names of available nonlinear solvers."),
});
export type GetNonLinearSolversOutput = z.infer<
  typeof GetNonLinearSolversOutputSchema
>;

export const GetNonLinearSolversDescription = "List the available nonlinear solvers. (OMC docs page is 404.)";

export async function getNonLinearSolvers(
  ctx: CallContext,
  _input: GetNonLinearSolversInput = {},
): Promise<GetNonLinearSolversOutput> {
  const raw = await ctx.call("getNonLinearSolvers()");
  return parseOutput(
    GetNonLinearSolversOutputSchema,
    { nonLinearSolvers: expectStringList(parse(raw)) },
    "getNonLinearSolvers",
  );
}
