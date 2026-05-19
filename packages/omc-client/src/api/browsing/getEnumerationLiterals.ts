/**
 * OMC: `function getEnumerationLiterals`
 *
 * ```modelica
 * function getEnumerationLiterals
 *   input TypeName className;
 *   output String[:] literals;
 * end getEnumerationLiterals;
 * ```
 *
 * Useful for populating dropdowns in parameter editors when the parameter
 * type is an enumeration.
 */

import { z } from "zod";

import type { CallContext } from "../../_shared/callContext.js";
import { TypeNameInput } from "../../_shared/inputs.js";
import { parseOutput } from "../../_shared/parseOutput.js";
import { expectStringList, parse } from "../../parse.js";

export const GetEnumerationLiteralsInputSchema = TypeNameInput;
export type GetEnumerationLiteralsInput = z.input<
  typeof GetEnumerationLiteralsInputSchema
>;

export const GetEnumerationLiteralsOutputSchema = z.object({
  literals: z
    .array(z.string())
    .describe("Literal names declared on the enumeration type, in source order."),
});
export type GetEnumerationLiteralsOutput = z.infer<
  typeof GetEnumerationLiteralsOutputSchema
>;

export const GetEnumerationLiteralsDescription =
  "Return the list of literal names declared on an enumeration type.";

export async function getEnumerationLiterals(
  ctx: CallContext,
  input: GetEnumerationLiteralsInput,
): Promise<GetEnumerationLiteralsOutput> {
  const raw = await ctx.call(`getEnumerationLiterals(${input.typeName})`);
  return parseOutput(
    GetEnumerationLiteralsOutputSchema,
    { literals: expectStringList(parse(raw)) },
    "getEnumerationLiterals",
  );
}
