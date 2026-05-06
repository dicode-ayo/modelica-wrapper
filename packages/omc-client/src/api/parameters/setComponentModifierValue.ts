/**
 * OMC: `function setComponentModifierValue`
 *
 * Set a modifier on a component. `expr` is the raw Modelica expression for
 * the value (e.g. `1.5`, `true`, `{1, 2, 3}`); empty string removes the
 * modifier. OMC requires the value wrapped in `$Code(=expr)` to bypass
 * string-escaping of the expression.
 */

import { z } from "zod";

import type { CallContext } from "../../_shared/callContext.js";
import { parseOutput } from "../../_shared/parseOutput.js";
import { expectBool, parse } from "../../parse.js";

export const SetComponentModifierValueInputSchema = z.object({
  typeName: z.string(),
  modifier: z.string(),
  expr: z.string(),
});
export type SetComponentModifierValueInput = z.input<
  typeof SetComponentModifierValueInputSchema
>;

export const SetComponentModifierValueOutputSchema = z.object({
  success: z.boolean(),
});
export type SetComponentModifierValueOutput = z.infer<
  typeof SetComponentModifierValueOutputSchema
>;

export async function setComponentModifierValue(
  ctx: CallContext,
  input: SetComponentModifierValueInput,
): Promise<SetComponentModifierValueOutput> {
  const codeArg = input.expr === "" ? "$Code(=)" : `$Code(=${input.expr})`;
  const raw = await ctx.call(
    `setComponentModifierValue(${input.typeName}, ${input.modifier}, ${codeArg})`,
  );
  return parseOutput(
    SetComponentModifierValueOutputSchema,
    { success: expectBool(parse(raw)) },
    "setComponentModifierValue",
  );
}
