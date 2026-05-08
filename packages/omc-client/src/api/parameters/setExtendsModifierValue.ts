/**
 * OMC: `function setExtendsModifierValue`
 *
 * Set a modifier on an `extends` clause. `expr = ""` removes the modifier.
 * Like setComponentModifierValue, the value is wrapped in `$Code(=...)`.
 */

import { z } from "zod";

import type { CallContext } from "../../_shared/callContext.js";
import {
  expr,
  extendsBase,
  typeNameOfExtends,
} from "../../_shared/fields.js";
import { SuccessOutput } from "../../_shared/outputs.js";
import { parseOutput } from "../../_shared/parseOutput.js";
import { expectBool, parse } from "../../parse.js";

export const SetExtendsModifierValueInputSchema = z.object({
  typeName: typeNameOfExtends,
  extendsBase: extendsBase.describe(
    "TypeName of the base class on the `extends` clause to mutate.",
  ),
  modifier: z.string().describe("Dotted path identifying the modifier within the extends clause."),
  expr,
});
export type SetExtendsModifierValueInput = z.input<
  typeof SetExtendsModifierValueInputSchema
>;

export const SetExtendsModifierValueOutputSchema = SuccessOutput;
export type SetExtendsModifierValueOutput = z.infer<
  typeof SetExtendsModifierValueOutputSchema
>;

export const SetExtendsModifierValueDescription = "Set a modifier on an element in an `extends` clause.";

export async function setExtendsModifierValue(
  ctx: CallContext,
  input: SetExtendsModifierValueInput,
): Promise<SetExtendsModifierValueOutput> {
  const codeArg = input.expr === "" ? "$Code(=)" : `$Code(=${input.expr})`;
  const raw = await ctx.call(
    `setExtendsModifierValue(${input.typeName}, ${input.extendsBase}, ${input.modifier}, ${codeArg})`,
  );
  return parseOutput(
    SetExtendsModifierValueOutputSchema,
    { success: expectBool(parse(raw)) },
    "setExtendsModifierValue",
  );
}
