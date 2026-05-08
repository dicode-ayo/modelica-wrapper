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
  typeName: z.string(),
  extendsBase: z.string(),
  modifier: z.string(),
});
export type GetExtendsModifierValueInput = z.input<
  typeof GetExtendsModifierValueInputSchema
>;

export const GetExtendsModifierValueOutputSchema = StringValueOutput;
export type GetExtendsModifierValueOutput = z.infer<
  typeof GetExtendsModifierValueOutputSchema
>;

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
