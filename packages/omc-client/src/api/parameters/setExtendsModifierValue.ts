/**
 * OMC: `function setExtendsModifierValue`
 *
 * Set a modifier on an `extends` clause. `expr = ""` removes the modifier.
 * Like setComponentModifierValue, the value is wrapped in `$Code(=...)`.
 */

import { z } from "zod";

import type { CallContext } from "../../_shared/callContext.js";
import { parseOutput } from "../../_shared/parseOutput.js";
import { expectBool, parse } from "../../parse.js";

export const SetExtendsModifierValueInputSchema = z.object({
  typeName: z.string(),
  extendsBase: z.string(),
  modifier: z.string(),
  expr: z.string(),
});
export type SetExtendsModifierValueInput = z.input<
  typeof SetExtendsModifierValueInputSchema
>;

export const SetExtendsModifierValueOutputSchema = z.object({
  success: z.boolean(),
});
export type SetExtendsModifierValueOutput = z.infer<
  typeof SetExtendsModifierValueOutputSchema
>;

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
