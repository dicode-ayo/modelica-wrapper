/**
 * OMC: `function getExtendsModifierValue`
 *
 * Read the value of a modifier on an `extends` clause.
 */

import { z } from "zod";

import type { CallContext } from "../../_shared/callContext.js";
import {
  extendsBase,
  typeNameOfExtends,
} from "../../_shared/fields.js";
import { StringValueOutput } from "../../_shared/outputs.js";
import { parseOutput } from "../../_shared/parseOutput.js";
import { asString, parse } from "../../parse.js";

export const GetExtendsModifierValueInputSchema = z.object({
  typeName: typeNameOfExtends,
  extendsBase,
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
  // Unlike `getComponentModifierValue` (which always quotes its result),
  // `getExtendsModifierValue` returns the binding *bare* when it is numeric
  // or boolean (e.g. `2.5`, `true`) and quoted when it is a string. `asString`
  // only handles the quoted/ident case, so fall back to the trimmed raw text
  // to preserve OMC's verbatim source rendering for scalar bindings.
  const v = parse(raw);
  return parseOutput(
    GetExtendsModifierValueOutputSchema,
    { value: asString(v) ?? raw.trim() },
    "getExtendsModifierValue",
  );
}
