/**
 * OMC: `function getJacobianMethods`
 *
 * Returns the list of available Jacobian-computation methods.
 */

import { z } from "zod";

import type { CallContext } from "../../_shared/callContext.js";
import { parseOutput } from "../../_shared/parseOutput.js";
import { expectStringList, parse } from "../../parse.js";

export const GetJacobianMethodsInputSchema = z.object({});
export type GetJacobianMethodsInput = z.input<
  typeof GetJacobianMethodsInputSchema
>;

export const GetJacobianMethodsOutputSchema = z.object({
  jacobianMethods: z.array(z.string()).describe("Names of available Jacobian-computation methods."),
});
export type GetJacobianMethodsOutput = z.infer<
  typeof GetJacobianMethodsOutputSchema
>;

export const GetJacobianMethodsDescription = "List the available Jacobian-computation methods. (OMC docs page is 404.)";

export async function getJacobianMethods(
  ctx: CallContext,
  _input: GetJacobianMethodsInput = {},
): Promise<GetJacobianMethodsOutput> {
  const raw = await ctx.call("getJacobianMethods()");
  return parseOutput(
    GetJacobianMethodsOutputSchema,
    { jacobianMethods: expectStringList(parse(raw)) },
    "getJacobianMethods",
  );
}
