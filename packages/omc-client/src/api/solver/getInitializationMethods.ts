/**
 * OMC: `function getInitializationMethods`
 *
 * Returns the list of available initialization methods.
 */

import { z } from "zod";

import type { CallContext } from "../../_shared/callContext.js";
import { parseOutput } from "../../_shared/parseOutput.js";
import { expectStringList, parse } from "../../parse.js";

export const GetInitializationMethodsInputSchema = z.object({});
export type GetInitializationMethodsInput = z.input<
  typeof GetInitializationMethodsInputSchema
>;

export const GetInitializationMethodsOutputSchema = z.object({
  initializationMethods: z.array(z.string()).describe("Names of available initialization methods."),
});
export type GetInitializationMethodsOutput = z.infer<
  typeof GetInitializationMethodsOutputSchema
>;

export const GetInitializationMethodsDescription = "List the available initialization methods. (OMC docs page is 404.)";

export async function getInitializationMethods(
  ctx: CallContext,
  _input: GetInitializationMethodsInput = {},
): Promise<GetInitializationMethodsOutput> {
  const raw = await ctx.call("getInitializationMethods()");
  return parseOutput(
    GetInitializationMethodsOutputSchema,
    { initializationMethods: expectStringList(parse(raw)) },
    "getInitializationMethods",
  );
}
