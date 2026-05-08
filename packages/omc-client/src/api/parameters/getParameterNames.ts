/**
 * OMC: `function getParameterNames`
 *
 * Returns the list of parameter names declared in a class.
 *
 * ```modelica
 * function getParameterNames
 *   input TypeName class_;
 *   output String[:] parameters;
 * end getParameterNames;
 * ```
 */

import { z } from "zod";

import type { CallContext } from "../../_shared/callContext.js";
import { TypeNameInput } from "../../_shared/inputs.js";
import { parseOutput } from "../../_shared/parseOutput.js";
import { expectStringList, parse } from "../../parse.js";

export const GetParameterNamesInputSchema = TypeNameInput;
export type GetParameterNamesInput = z.input<
  typeof GetParameterNamesInputSchema
>;

export const GetParameterNamesOutputSchema = z.object({
  parameters: z.array(z.string()).describe("Parameter names declared in the class."),
});
export type GetParameterNamesOutput = z.infer<
  typeof GetParameterNamesOutputSchema
>;

export const GetParameterNamesDescription = "List the parameter names declared in a class.";

export async function getParameterNames(
  ctx: CallContext,
  input: GetParameterNamesInput,
): Promise<GetParameterNamesOutput> {
  const raw = await ctx.call(`getParameterNames(${input.typeName})`);
  return parseOutput(
    GetParameterNamesOutputSchema,
    { parameters: expectStringList(parse(raw)) },
    "getParameterNames",
  );
}
