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
  typeName: z.string(),
  extendsBase: z.string(),
  useQuotes: z.boolean().optional().default(false),
});
export type GetExtendsModifierNamesInput = z.input<
  typeof GetExtendsModifierNamesInputSchema
>;

export const GetExtendsModifierNamesOutputSchema = z.object({
  modifiers: z.array(z.string()),
});
export type GetExtendsModifierNamesOutput = z.infer<
  typeof GetExtendsModifierNamesOutputSchema
>;

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
