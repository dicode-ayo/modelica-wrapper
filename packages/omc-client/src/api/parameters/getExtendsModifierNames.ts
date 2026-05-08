/**
 * OMC: `function getExtendsModifierNames`
 *
 * Returns modifier names attached to an `extends` clause.
 */

import { z } from "zod";

import type { CallContext } from "../../_shared/callContext.js";
import { mlBool } from "../../_shared/format.js";
import { parseOutput } from "../../_shared/parseOutput.js";
import { expectStringList, parse } from "../../parse.js";

export const GetExtendsModifierNamesInputSchema = z.object({
  typeName: z.string().describe("Class containing the `extends` clause."),
  extendsBase: z.string().describe("TypeName of the base class on the `extends` clause to inspect."),
  useQuotes: z.boolean().optional().default(false).describe("Quote string fields in the OMC raw response when true."),
});
export type GetExtendsModifierNamesInput = z.input<
  typeof GetExtendsModifierNamesInputSchema
>;

export const GetExtendsModifierNamesOutputSchema = z.object({
  modifiers: z.array(z.string()).describe("Modifier names declared on the targeted `extends` clause."),
});
export type GetExtendsModifierNamesOutput = z.infer<
  typeof GetExtendsModifierNamesOutputSchema
>;

export const GetExtendsModifierNamesDescription = "Return the names of the modifiers attached to an `extends` clause.";

export async function getExtendsModifierNames(
  ctx: CallContext,
  input: GetExtendsModifierNamesInput,
): Promise<GetExtendsModifierNamesOutput> {
  const useQuotes = input.useQuotes ?? false;
  const raw = await ctx.call(
    `getExtendsModifierNames(${input.typeName}, ${input.extendsBase}, useQuotes=${mlBool(useQuotes)})`,
  );
  return parseOutput(
    GetExtendsModifierNamesOutputSchema,
    { modifiers: expectStringList(parse(raw)) },
    "getExtendsModifierNames",
  );
}
