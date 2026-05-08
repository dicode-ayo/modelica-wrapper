/**
 * OMC: `function getLinearSolvers`
 *
 * Returns the list of available linear solvers.
 */

import { z } from "zod";

import type { CallContext } from "../../_shared/callContext.js";
import { parseOutput } from "../../_shared/parseOutput.js";
import { expectStringList, parse } from "../../parse.js";

export const GetLinearSolversInputSchema = z.object({});
export type GetLinearSolversInput = z.input<
  typeof GetLinearSolversInputSchema
>;

export const GetLinearSolversOutputSchema = z.object({
  linearSolvers: z.array(z.string()).describe("Names of available linear solvers."),
});
export type GetLinearSolversOutput = z.infer<
  typeof GetLinearSolversOutputSchema
>;

export const GetLinearSolversDescription = "List the available linear solvers. (OMC docs page is 404.)";

export async function getLinearSolvers(
  ctx: CallContext,
  _input: GetLinearSolversInput = {},
): Promise<GetLinearSolversOutput> {
  const raw = await ctx.call("getLinearSolvers()");
  return parseOutput(
    GetLinearSolversOutputSchema,
    { linearSolvers: expectStringList(parse(raw)) },
    "getLinearSolvers",
  );
}
