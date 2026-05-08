/**
 * OMC: `function getExtendsModifierValue`
 *
 * Read the value of a modifier on an `extends` clause.
 */

import { z } from "zod";

import type { CallContext } from "../../_shared/callContext.js";
import { StringValueOutput } from "../../_shared/outputs.js";
import { parseOutput } from "../../_shared/parseOutput.js";
import { asString, parse } from "../../parse.js";

export const GetExtendsModifierValueInputSchema = z.object({
  typeName: z.string().describe("Class containing the `extends` clause."),
  extendsBase: z.string().describe("TypeName of the base class on the `extends` clause to inspect."),
  modifier: z.string().describe("Dotted path identifying the modifier within the extends clause."),
});
export type GetExtendsModifierValueInput = z.input<
  typeof GetExtendsModifierValueInputSchema
>;

export const GetExtendsModifierValueOutputSchema = StringValueOutput;
export type GetExtendsModifierValueOutput = z.infer<
  typeof GetExtendsModifierValueOutputSchema
>;

export const GetExtendsModifierValueDescription = "Return the modifier value for a modifier on an `extends` clause.";

export async function getExtendsModifierValue(
  ctx: CallContext,
  input: GetExtendsModifierValueInput,
): Promise<GetExtendsModifierValueOutput> {
  const raw = await ctx.call(
    `getExtendsModifierValue(${input.typeName}, ${input.extendsBase}, ${input.modifier})`,
  );
  const v = parse(raw);
  return parseOutput(
    GetExtendsModifierValueOutputSchema,
    { value: asString(v) ?? "" },
    "getExtendsModifierValue",
  );
}
