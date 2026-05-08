/**
 * OMC: `function getDefaultComponentName`
 *
 * ```modelica
 * function getDefaultComponentName
 *   input TypeName cl;
 *   output String name;
 * end getDefaultComponentName;
 * ```
 *
 * Returns the value of the class's `defaultComponentName` annotation if any.
 */

import { z } from "zod";

import type { CallContext } from "../../_shared/callContext.js";
import { TypeNameInput } from "../../_shared/inputs.js";
import { parseOutput } from "../../_shared/parseOutput.js";
import { asString, parse } from "../../parse.js";

export const GetDefaultComponentNameInputSchema = TypeNameInput;
export type GetDefaultComponentNameInput = z.input<
  typeof GetDefaultComponentNameInputSchema
>;

export const GetDefaultComponentNameOutputSchema = z.object({
  name: z.string().describe("Value of the class's `defaultComponentName` annotation; empty if not set."),
});
export type GetDefaultComponentNameOutput = z.infer<
  typeof GetDefaultComponentNameOutputSchema
>;

export const GetDefaultComponentNameDescription =
  "Return the value of the class's `defaultComponentName` annotation (used by editors as a default instance name).";

export async function getDefaultComponentName(
  ctx: CallContext,
  input: GetDefaultComponentNameInput,
): Promise<GetDefaultComponentNameOutput> {
  const raw = await ctx.call(`getDefaultComponentName(${input.typeName})`);
  return parseOutput(
    GetDefaultComponentNameOutputSchema,
    { name: asString(parse(raw)) ?? "" },
    "getDefaultComponentName",
  );
}
